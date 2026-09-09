using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Codex.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class UserIdentities : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "user_identities",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Provider = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    ProviderUserId = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    Email = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_user_identities", x => x.Id);
                    table.ForeignKey(
                        name: "FK_user_identities_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_user_identities_UserId",
                table: "user_identities",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "ix_user_identities_provider_subject_unique",
                table: "user_identities",
                columns: new[] { "Provider", "ProviderUserId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "user_identities");
        }
    }
}
