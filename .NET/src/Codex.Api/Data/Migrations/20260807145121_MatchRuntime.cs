using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Codex.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class MatchRuntime : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_submissions_MatchId",
                table: "submissions");

            migrationBuilder.DropIndex(
                name: "IX_submissions_RoomQueuePhaseId_ParticipantId",
                table: "submissions");

            migrationBuilder.DropIndex(
                name: "IX_submissions_RoomQueuePhaseId_Score",
                table: "submissions");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "ReadyAt",
                table: "submissions",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "CurrentPhaseEndedAt",
                table: "matches",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "CurrentPhaseEndsAt",
                table: "matches",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "CurrentPhaseStartedAt",
                table: "matches",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "PausedSecondsLeft",
                table: "matches",
                type: "integer",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_submissions_MatchId_RoomQueuePhaseId_ParticipantId",
                table: "submissions",
                columns: new[] { "MatchId", "RoomQueuePhaseId", "ParticipantId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_submissions_MatchId_RoomQueuePhaseId_Score",
                table: "submissions",
                columns: new[] { "MatchId", "RoomQueuePhaseId", "Score" });

            migrationBuilder.CreateIndex(
                name: "IX_submissions_RoomQueuePhaseId",
                table: "submissions",
                column: "RoomQueuePhaseId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_submissions_MatchId_RoomQueuePhaseId_ParticipantId",
                table: "submissions");

            migrationBuilder.DropIndex(
                name: "IX_submissions_MatchId_RoomQueuePhaseId_Score",
                table: "submissions");

            migrationBuilder.DropIndex(
                name: "IX_submissions_RoomQueuePhaseId",
                table: "submissions");

            migrationBuilder.DropColumn(
                name: "ReadyAt",
                table: "submissions");

            migrationBuilder.DropColumn(
                name: "CurrentPhaseEndedAt",
                table: "matches");

            migrationBuilder.DropColumn(
                name: "CurrentPhaseEndsAt",
                table: "matches");

            migrationBuilder.DropColumn(
                name: "CurrentPhaseStartedAt",
                table: "matches");

            migrationBuilder.DropColumn(
                name: "PausedSecondsLeft",
                table: "matches");

            migrationBuilder.CreateIndex(
                name: "IX_submissions_MatchId",
                table: "submissions",
                column: "MatchId");

            migrationBuilder.CreateIndex(
                name: "IX_submissions_RoomQueuePhaseId_ParticipantId",
                table: "submissions",
                columns: new[] { "RoomQueuePhaseId", "ParticipantId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_submissions_RoomQueuePhaseId_Score",
                table: "submissions",
                columns: new[] { "RoomQueuePhaseId", "Score" });
        }
    }
}
