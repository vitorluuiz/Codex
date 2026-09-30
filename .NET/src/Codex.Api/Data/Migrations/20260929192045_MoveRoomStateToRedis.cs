using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Codex.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class MoveRoomStateToRedis : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_matches_rooms_RoomId",
                table: "matches");

            migrationBuilder.DropForeignKey(
                name: "FK_submissions_participants_ParticipantId",
                table: "submissions");

            migrationBuilder.DropForeignKey(
                name: "FK_submissions_room_queue_phases_RoomQueuePhaseId",
                table: "submissions");

            migrationBuilder.DropTable(
                name: "participants");

            migrationBuilder.DropTable(
                name: "room_queue_phases");

            migrationBuilder.DropTable(
                name: "room_queue_sets");

            migrationBuilder.DropTable(
                name: "rooms");

            migrationBuilder.DropIndex(
                name: "IX_submissions_ParticipantId",
                table: "submissions");

            migrationBuilder.DropIndex(
                name: "IX_submissions_RoomQueuePhaseId",
                table: "submissions");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "rooms",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    LeaderUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Capacity = table.Column<int>(type: "integer", nullable: false),
                    Code = table.Column<string>(type: "character varying(6)", maxLength: 6, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ExpiresAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    Locked = table.Column<bool>(type: "boolean", nullable: false),
                    MatchMode = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    QueueRevision = table.Column<int>(type: "integer", nullable: false),
                    RequireAccount = table.Column<bool>(type: "boolean", nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_rooms", x => x.Id);
                    table.ForeignKey(
                        name: "FK_rooms_users_LeaderUserId",
                        column: x => x.LeaderUserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "participants",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    RoomId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: true),
                    AvatarIndex = table.Column<int>(type: "integer", nullable: false),
                    DisplayName = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    DisplayNameNormalized = table.Column<string>(type: "text", nullable: false, computedColumnSql: "lower(\"DisplayName\")", stored: true),
                    InResultsSince = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    JoinedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    LoggedIn = table.Column<bool>(type: "boolean", nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_participants", x => x.Id);
                    table.ForeignKey(
                        name: "FK_participants_rooms_RoomId",
                        column: x => x.RoomId,
                        principalTable: "rooms",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_participants_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "room_queue_sets",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    RoomId = table.Column<Guid>(type: "uuid", nullable: false),
                    Color = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    OrderIndex = table.Column<int>(type: "integer", nullable: false),
                    SourcePhaseSetId = table.Column<Guid>(type: "uuid", nullable: false),
                    Title = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_room_queue_sets", x => x.Id);
                    table.ForeignKey(
                        name: "FK_room_queue_sets_rooms_RoomId",
                        column: x => x.RoomId,
                        principalTable: "rooms",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "room_queue_phases",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    RoomId = table.Column<Guid>(type: "uuid", nullable: false),
                    RoomQueueSetId = table.Column<Guid>(type: "uuid", nullable: false),
                    BasePoints = table.Column<int>(type: "integer", nullable: false),
                    ContentJson = table.Column<string>(type: "jsonb", nullable: false),
                    Kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Name = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    OrderIndex = table.Column<int>(type: "integer", nullable: false),
                    PointsMultiplier = table.Column<decimal>(type: "numeric(5,2)", precision: 5, scale: 2, nullable: false),
                    SourcePhaseId = table.Column<Guid>(type: "uuid", nullable: false),
                    TimeSeconds = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_room_queue_phases", x => x.Id);
                    table.ForeignKey(
                        name: "FK_room_queue_phases_room_queue_sets_RoomQueueSetId",
                        column: x => x.RoomQueueSetId,
                        principalTable: "room_queue_sets",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_room_queue_phases_rooms_RoomId",
                        column: x => x.RoomId,
                        principalTable: "rooms",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_submissions_ParticipantId",
                table: "submissions",
                column: "ParticipantId");

            migrationBuilder.CreateIndex(
                name: "IX_submissions_RoomQueuePhaseId",
                table: "submissions",
                column: "RoomQueuePhaseId");

            migrationBuilder.CreateIndex(
                name: "IX_participants_RoomId_Status_JoinedAt",
                table: "participants",
                columns: new[] { "RoomId", "Status", "JoinedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_participants_UserId",
                table: "participants",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "ix_participants_room_display_name_unique",
                table: "participants",
                columns: new[] { "RoomId", "DisplayNameNormalized" },
                unique: true,
                filter: "\"Status\" <> 'Rejected'");

            migrationBuilder.CreateIndex(
                name: "IX_room_queue_phases_RoomId_OrderIndex",
                table: "room_queue_phases",
                columns: new[] { "RoomId", "OrderIndex" });

            migrationBuilder.CreateIndex(
                name: "IX_room_queue_phases_RoomQueueSetId",
                table: "room_queue_phases",
                column: "RoomQueueSetId");

            migrationBuilder.CreateIndex(
                name: "IX_room_queue_sets_RoomId_OrderIndex",
                table: "room_queue_sets",
                columns: new[] { "RoomId", "OrderIndex" });

            migrationBuilder.CreateIndex(
                name: "IX_rooms_Code",
                table: "rooms",
                column: "Code");

            migrationBuilder.CreateIndex(
                name: "IX_rooms_LeaderUserId",
                table: "rooms",
                column: "LeaderUserId");

            migrationBuilder.AddForeignKey(
                name: "FK_matches_rooms_RoomId",
                table: "matches",
                column: "RoomId",
                principalTable: "rooms",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_submissions_participants_ParticipantId",
                table: "submissions",
                column: "ParticipantId",
                principalTable: "participants",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_submissions_room_queue_phases_RoomQueuePhaseId",
                table: "submissions",
                column: "RoomQueuePhaseId",
                principalTable: "room_queue_phases",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }
    }
}
