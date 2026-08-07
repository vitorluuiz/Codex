using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Codex.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class ParticipantInResults : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "InResultsSince",
                table: "participants",
                type: "timestamp with time zone",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "InResultsSince",
                table: "participants");
        }
    }
}
