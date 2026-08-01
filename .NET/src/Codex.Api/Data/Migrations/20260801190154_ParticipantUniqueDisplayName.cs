using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Codex.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class ParticipantUniqueDisplayName : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "DisplayNameNormalized",
                table: "participants",
                type: "text",
                nullable: false,
                computedColumnSql: "lower(\"DisplayName\")",
                stored: true);

            migrationBuilder.CreateIndex(
                name: "ix_participants_room_display_name_unique",
                table: "participants",
                columns: new[] { "RoomId", "DisplayNameNormalized" },
                unique: true,
                filter: "\"Status\" <> 'Rejected'");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_participants_room_display_name_unique",
                table: "participants");

            migrationBuilder.DropColumn(
                name: "DisplayNameNormalized",
                table: "participants");
        }
    }
}
