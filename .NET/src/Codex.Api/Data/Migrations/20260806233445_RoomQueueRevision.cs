using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Codex.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class RoomQueueRevision : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // defaultValue 0 do scaffolding fica como esta, ao contrario do que aconteceu na
            // UserAudience: aqui o palpite e o valor certo. Sala que ja existe nunca teve mutacao
            // de fila contada, e a primeira que ela receber publica revision 1.
            migrationBuilder.AddColumn<int>(
                name: "QueueRevision",
                table: "rooms",
                type: "integer",
                nullable: false,
                defaultValue: 0);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "QueueRevision",
                table: "rooms");
        }
    }
}
