using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Codex.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class UserAudience : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // defaultValue trocado a mao de "" (o palpite do scaffolding para string nao-nula)
            // para "Teacher": a coluna e um enum convertido em string, e "" nao e um valor
            // valido de Audience — toda conta ja existente falharia ao ser lida de volta.
            migrationBuilder.AddColumn<string>(
                name: "Audience",
                table: "users",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "Teacher");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Audience",
                table: "users");
        }
    }
}
