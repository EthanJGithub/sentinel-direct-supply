using Microsoft.EntityFrameworkCore;
using Sentinel.Catalog;

var builder = WebApplication.CreateBuilder(args);

// --- Postgres connection (Neon in the cloud, local pg in docker-compose) ---
// NB: an empty ConnectionStrings:Catalog in appsettings would otherwise win over the
// CATALOG_DB env var, so treat empty/whitespace as "not set".
var conn = builder.Configuration.GetConnectionString("Catalog");
if (string.IsNullOrWhiteSpace(conn)) conn = Environment.GetEnvironmentVariable("CATALOG_DB");
if (string.IsNullOrWhiteSpace(conn)) conn = "Host=localhost;Port=5432;Database=sentinel;Username=sentinel;Password=sentinel";
builder.Services.AddDbContext<CatalogDb>(o => o.UseNpgsql(conn));
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod()));

var app = builder.Build();
app.UseCors();
app.UseSwagger();
app.UseSwaggerUI();

// --- seed on startup ---
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<CatalogDb>();
    var log = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();
    var seedDir = Environment.GetEnvironmentVariable("SEED_DIR") ?? FindSeedDir();
    var attempts = 0;
    while (true)
    {
        try { await Seeder.SeedAsync(db, seedDir, log); break; }
        catch (Exception ex) when (attempts++ < 10)
        {
            log.LogWarning("DB not ready ({Msg}); retrying {N}/10...", ex.Message, attempts);
            await Task.Delay(3000);
        }
    }
}

// ---------------------------------------------------------------------------
// Endpoints — the system-of-record API the Python agent + MCP server call.
// ---------------------------------------------------------------------------
app.MapGet("/health", () => Results.Ok(new { status = "ok", service = "catalog-csharp" }));

// catalog_search: find candidate SKUs by free text / category / room
app.MapGet("/api/catalog/search", async (CatalogDb db, string? query, string? category, string? room, int? limit) =>
{
    var q = db.Products.Include(p => p.ContractPrices).AsQueryable();
    if (!string.IsNullOrWhiteSpace(category)) q = q.Where(p => p.Category == category);
    if (!string.IsNullOrWhiteSpace(query))
    {
        var t = query.ToLower();
        q = q.Where(p => p.Name.ToLower().Contains(t) || p.Subcategory.ToLower().Contains(t)
                         || p.Category.ToLower().Contains(t) || p.Vendor.ToLower().Contains(t));
    }
    var list = await q.Take(limit ?? 50).ToListAsync();
    if (!string.IsNullOrWhiteSpace(room))
        list = list.Where(p => p.ApplicableRooms.Contains(room)).ToList();
    return Results.Ok(list.Select(ProductDto.From));
});

// get a single SKU
app.MapGet("/api/catalog/{sku}", async (CatalogDb db, string sku) =>
{
    var p = await db.Products.Include(x => x.ContractPrices).FirstOrDefaultAsync(x => x.Sku == sku);
    return p is null ? Results.NotFound(new { sku, error = "not found" }) : Results.Ok(ProductDto.From(p));
});

// get_contract_price: best GPO price per SKU (the DSSI/Attainia value)
app.MapPost("/api/contract/price", async (CatalogDb db, PriceRequest req) =>
{
    var prods = await db.Products.Include(p => p.ContractPrices)
        .Where(p => req.Skus.Contains(p.Sku)).ToListAsync();
    var lines = prods.Select(p =>
    {
        var pool = p.ContractPrices.AsEnumerable();
        if (!string.IsNullOrWhiteSpace(req.ContractId))
            pool = pool.Where(cp => cp.ContractId == req.ContractId);
        var best = pool.OrderBy(cp => cp.Price).FirstOrDefault();
        var bp = best?.Price ?? p.ListPrice;
        var sav = p.ListPrice == 0 ? 0 : Math.Round((p.ListPrice - bp) / p.ListPrice * 100, 1);
        return new PriceLine(p.Sku, p.ListPrice, bp, best?.ContractId, sav);
    });
    return Results.Ok(lines);
});

// check_stock
app.MapGet("/api/stock/{sku}", async (CatalogDb db, string sku) =>
{
    var p = await db.Products.FirstOrDefaultAsync(x => x.Sku == sku);
    return p is null ? Results.NotFound() : Results.Ok(new { sku, p.StockOnHand, inStock = p.StockOnHand > 0 });
});

// find_substitution: compliant alternative in same category (used by re-source loop)
app.MapGet("/api/catalog/{sku}/substitutions", async (CatalogDb db, string sku, int? limit) =>
{
    var orig = await db.Products.FirstOrDefaultAsync(x => x.Sku == sku);
    if (orig is null) return Results.NotFound();
    var subs = await db.Products.Include(p => p.ContractPrices)
        .Where(p => p.Category == orig.Category && p.Sku != sku && p.Compliant)
        .OrderBy(p => p.ListPrice).Take(limit ?? 5).ToListAsync();
    return Results.Ok(subs.Select(ProductDto.From));
});

// place_order: the HITL-approved action — writes an immutable order
app.MapPost("/api/orders", async (CatalogDb db, PlaceOrderRequest req) =>
{
    var order = new Order { PlanId = req.PlanId, FacilityName = req.FacilityName };
    decimal total = 0;
    foreach (var l in req.Lines)
    {
        var p = await db.Products.Include(x => x.ContractPrices).FirstOrDefaultAsync(x => x.Sku == l.Sku);
        if (p is null) continue;
        var unit = p.ContractPrices.Where(cp => l.ContractId == null || cp.ContractId == l.ContractId)
                       .OrderBy(cp => cp.Price).FirstOrDefault()?.Price ?? p.ListPrice;
        order.Lines.Add(new OrderLine { Sku = l.Sku, Qty = l.Qty, UnitPrice = unit, ContractId = l.ContractId });
        total += unit * l.Qty;
    }
    order.Total = total;
    db.Orders.Add(order);
    await db.SaveChangesAsync();
    return Results.Ok(new { order.Id, order.Status, order.Total, lineCount = order.Lines.Count });
});

app.MapGet("/api/orders/{id:guid}", async (CatalogDb db, Guid id) =>
{
    var o = await db.Orders.Include(x => x.Lines).FirstOrDefaultAsync(x => x.Id == id);
    return o is null ? Results.NotFound() : Results.Ok(o);
});

app.MapGet("/api/categories", async (CatalogDb db) =>
    Results.Ok(await db.Products.GroupBy(p => p.Category)
        .Select(g => new { category = g.Key, count = g.Count() }).ToListAsync()));

app.Run();

static string FindSeedDir()
{
    foreach (var c in new[] { "/data/catalog", "data/catalog", "../../data/catalog", "../../../data/catalog" })
        if (Directory.Exists(c)) return c;
    return "/data/catalog";
}
