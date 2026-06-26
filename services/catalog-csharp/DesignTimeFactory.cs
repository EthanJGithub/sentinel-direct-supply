using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Sentinel.Catalog;

/// <summary>Lets `dotnet ef migrations` build the model at design time without a
/// live database. The runtime connection comes from CATALOG_DB / config.</summary>
public class DesignTimeFactory : IDesignTimeDbContextFactory<CatalogDb>
{
    public CatalogDb CreateDbContext(string[] args)
    {
        var conn = Environment.GetEnvironmentVariable("CATALOG_DB")
                   ?? "Host=localhost;Port=5432;Database=sentinel;Username=sentinel;Password=sentinel";
        var options = new DbContextOptionsBuilder<CatalogDb>().UseNpgsql(conn).Options;
        return new CatalogDb(options);
    }
}
