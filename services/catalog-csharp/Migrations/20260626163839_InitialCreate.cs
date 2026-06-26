using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Sentinel.Catalog.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Contracts",
                columns: table => new
                {
                    Id = table.Column<string>(type: "text", nullable: false),
                    GpoName = table.Column<string>(type: "text", nullable: false),
                    Discount = table.Column<decimal>(type: "numeric(5,4)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Contracts", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Orders",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PlanId = table.Column<string>(type: "text", nullable: false),
                    FacilityName = table.Column<string>(type: "text", nullable: false),
                    Total = table.Column<decimal>(type: "numeric", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Orders", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Products",
                columns: table => new
                {
                    Sku = table.Column<string>(type: "text", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    Category = table.Column<string>(type: "text", nullable: false),
                    Subcategory = table.Column<string>(type: "text", nullable: false),
                    Vendor = table.Column<string>(type: "text", nullable: false),
                    Unit = table.Column<string>(type: "text", nullable: false),
                    ListPrice = table.Column<decimal>(type: "numeric(12,2)", nullable: false),
                    StockOnHand = table.Column<int>(type: "integer", nullable: false),
                    Compliant = table.Column<bool>(type: "boolean", nullable: false),
                    ApplicableRooms = table.Column<string>(type: "jsonb", nullable: false),
                    Attributes = table.Column<string>(type: "jsonb", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Products", x => x.Sku);
                });

            migrationBuilder.CreateTable(
                name: "OrderLines",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    OrderId = table.Column<Guid>(type: "uuid", nullable: false),
                    Sku = table.Column<string>(type: "text", nullable: false),
                    Qty = table.Column<int>(type: "integer", nullable: false),
                    UnitPrice = table.Column<decimal>(type: "numeric", nullable: false),
                    ContractId = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OrderLines", x => x.Id);
                    table.ForeignKey(
                        name: "FK_OrderLines_Orders_OrderId",
                        column: x => x.OrderId,
                        principalTable: "Orders",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ContractPrices",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Sku = table.Column<string>(type: "text", nullable: false),
                    ContractId = table.Column<string>(type: "text", nullable: false),
                    Price = table.Column<decimal>(type: "numeric(12,2)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ContractPrices", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ContractPrices_Contracts_ContractId",
                        column: x => x.ContractId,
                        principalTable: "Contracts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_ContractPrices_Products_Sku",
                        column: x => x.Sku,
                        principalTable: "Products",
                        principalColumn: "Sku",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ContractPrices_ContractId",
                table: "ContractPrices",
                column: "ContractId");

            migrationBuilder.CreateIndex(
                name: "IX_ContractPrices_Sku",
                table: "ContractPrices",
                column: "Sku");

            migrationBuilder.CreateIndex(
                name: "IX_OrderLines_OrderId",
                table: "OrderLines",
                column: "OrderId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ContractPrices");

            migrationBuilder.DropTable(
                name: "OrderLines");

            migrationBuilder.DropTable(
                name: "Contracts");

            migrationBuilder.DropTable(
                name: "Products");

            migrationBuilder.DropTable(
                name: "Orders");
        }
    }
}
