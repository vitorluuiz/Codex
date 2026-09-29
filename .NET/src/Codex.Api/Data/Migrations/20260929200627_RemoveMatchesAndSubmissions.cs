using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Codex.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class RemoveMatchesAndSubmissions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "submissions");

            migrationBuilder.DropTable(
                name: "matches");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "matches",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CurrentPhaseEndedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CurrentPhaseEndsAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CurrentPhaseIndex = table.Column<int>(type: "integer", nullable: false),
                    CurrentPhaseStartedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    FinishedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    Mode = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    PausedSecondsLeft = table.Column<int>(type: "integer", nullable: true),
                    RoomId = table.Column<Guid>(type: "uuid", nullable: false),
                    StartedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_matches", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "submissions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    MatchId = table.Column<Guid>(type: "uuid", nullable: false),
                    AiSuggestionsJson = table.Column<string>(type: "jsonb", nullable: true),
                    AnswerJson = table.Column<string>(type: "jsonb", nullable: false),
                    Correct = table.Column<bool>(type: "boolean", nullable: true),
                    ElapsedSeconds = table.Column<int>(type: "integer", nullable: false),
                    Explanation = table.Column<string>(type: "text", nullable: true),
                    Grading = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    ParticipantId = table.Column<Guid>(type: "uuid", nullable: false),
                    ReadyAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    RoomQueuePhaseId = table.Column<Guid>(type: "uuid", nullable: false),
                    Score = table.Column<int>(type: "integer", nullable: true),
                    SubmittedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    TestsPassedJson = table.Column<string>(type: "jsonb", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_submissions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_submissions_matches_MatchId",
                        column: x => x.MatchId,
                        principalTable: "matches",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_matches_RoomId",
                table: "matches",
                column: "RoomId");

            migrationBuilder.CreateIndex(
                name: "IX_submissions_MatchId_RoomQueuePhaseId_ParticipantId",
                table: "submissions",
                columns: new[] { "MatchId", "RoomQueuePhaseId", "ParticipantId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_submissions_MatchId_RoomQueuePhaseId_Score",
                table: "submissions",
                columns: new[] { "MatchId", "RoomQueuePhaseId", "Score" });
        }
    }
}
