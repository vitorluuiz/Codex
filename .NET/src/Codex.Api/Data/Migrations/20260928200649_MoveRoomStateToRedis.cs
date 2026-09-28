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
                name: "FK_participants_rooms_RoomId",
                table: "participants");

            migrationBuilder.DropForeignKey(
                name: "FK_room_queue_phases_rooms_RoomId",
                table: "room_queue_phases");

            migrationBuilder.DropForeignKey(
                name: "FK_room_queue_sets_rooms_RoomId",
                table: "room_queue_sets");

            migrationBuilder.DropForeignKey(
                name: "FK_rooms_users_LeaderUserId",
                table: "rooms");

            migrationBuilder.DropForeignKey(
                name: "FK_submissions_matches_MatchId",
                table: "submissions");

            migrationBuilder.DropForeignKey(
                name: "FK_submissions_participants_ParticipantId",
                table: "submissions");

            migrationBuilder.DropForeignKey(
                name: "FK_submissions_room_queue_phases_RoomQueuePhaseId",
                table: "submissions");

            migrationBuilder.DropPrimaryKey(
                name: "PK_submissions",
                table: "submissions");

            migrationBuilder.DropIndex(
                name: "IX_submissions_MatchId_RoomQueuePhaseId_Score",
                table: "submissions");

            migrationBuilder.DropPrimaryKey(
                name: "PK_matches",
                table: "matches");

            migrationBuilder.DropIndex(
                name: "IX_matches_RoomId",
                table: "matches");

            migrationBuilder.DropPrimaryKey(
                name: "PK_rooms",
                table: "rooms");

            migrationBuilder.RenameTable(
                name: "submissions",
                newName: "Submissions");

            migrationBuilder.RenameTable(
                name: "matches",
                newName: "Matches");

            migrationBuilder.RenameTable(
                name: "rooms",
                newName: "Room");

            migrationBuilder.RenameIndex(
                name: "IX_submissions_RoomQueuePhaseId",
                table: "Submissions",
                newName: "IX_Submissions_RoomQueuePhaseId");

            migrationBuilder.RenameIndex(
                name: "IX_submissions_ParticipantId",
                table: "Submissions",
                newName: "IX_Submissions_ParticipantId");

            migrationBuilder.RenameIndex(
                name: "IX_submissions_MatchId_RoomQueuePhaseId_ParticipantId",
                table: "Submissions",
                newName: "IX_Submissions_MatchId_RoomQueuePhaseId_ParticipantId");

            migrationBuilder.RenameIndex(
                name: "IX_rooms_LeaderUserId",
                table: "Room",
                newName: "IX_Room_LeaderUserId");

            migrationBuilder.RenameIndex(
                name: "IX_rooms_Code",
                table: "Room",
                newName: "IX_Room_Code");

            migrationBuilder.AlterColumn<string>(
                name: "TestsPassedJson",
                table: "Submissions",
                type: "text",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "jsonb",
                oldNullable: true);

            migrationBuilder.AlterColumn<int>(
                name: "Grading",
                table: "Submissions",
                type: "integer",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(16)",
                oldMaxLength: 16);

            migrationBuilder.AlterColumn<string>(
                name: "AnswerJson",
                table: "Submissions",
                type: "text",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "jsonb");

            migrationBuilder.AlterColumn<string>(
                name: "AiSuggestionsJson",
                table: "Submissions",
                type: "text",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "jsonb",
                oldNullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "MatchId1",
                table: "Submissions",
                type: "uuid",
                nullable: true);

            migrationBuilder.AlterColumn<int>(
                name: "Status",
                table: "Matches",
                type: "integer",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(16)",
                oldMaxLength: 16);

            migrationBuilder.AlterColumn<int>(
                name: "Mode",
                table: "Matches",
                type: "integer",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(16)",
                oldMaxLength: 16);

            migrationBuilder.AlterColumn<int>(
                name: "Status",
                table: "Room",
                type: "integer",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(16)",
                oldMaxLength: 16);

            migrationBuilder.AlterColumn<int>(
                name: "MatchMode",
                table: "Room",
                type: "integer",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(16)",
                oldMaxLength: 16,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "Code",
                table: "Room",
                type: "text",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(6)",
                oldMaxLength: 6);

            migrationBuilder.AddColumn<Guid>(
                name: "LeaderId",
                table: "Room",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.AddPrimaryKey(
                name: "PK_Submissions",
                table: "Submissions",
                column: "Id");

            migrationBuilder.AddPrimaryKey(
                name: "PK_Matches",
                table: "Matches",
                column: "Id");

            migrationBuilder.AddPrimaryKey(
                name: "PK_Room",
                table: "Room",
                column: "Id");

            migrationBuilder.CreateIndex(
                name: "IX_Submissions_MatchId1",
                table: "Submissions",
                column: "MatchId1");

            migrationBuilder.CreateIndex(
                name: "IX_Matches_RoomId_Mode",
                table: "Matches",
                columns: new[] { "RoomId", "Mode" },
                filter: "status != 'Finished'");

            migrationBuilder.CreateIndex(
                name: "IX_Room_LeaderId",
                table: "Room",
                column: "LeaderId");

            migrationBuilder.AddForeignKey(
                name: "FK_Matches_Room_RoomId",
                table: "Matches",
                column: "RoomId",
                principalTable: "Room",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_Room_users_LeaderId",
                table: "Room",
                column: "LeaderId",
                principalTable: "users",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_Submissions_Matches_MatchId",
                table: "Submissions",
                column: "MatchId",
                principalTable: "Matches",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Submissions_Matches_MatchId1",
                table: "Submissions",
                column: "MatchId1",
                principalTable: "Matches",
                principalColumn: "Id");

            migrationBuilder.AddForeignKey(
                name: "FK_Submissions_participants_ParticipantId",
                table: "Submissions",
                column: "ParticipantId",
                principalTable: "participants",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_Submissions_room_queue_phases_RoomQueuePhaseId",
                table: "Submissions",
                column: "RoomQueuePhaseId",
                principalTable: "room_queue_phases",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_participants_Room_RoomId",
                table: "participants",
                column: "RoomId",
                principalTable: "Room",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_room_queue_phases_Room_RoomId",
                table: "room_queue_phases",
                column: "RoomId",
                principalTable: "Room",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_room_queue_sets_Room_RoomId",
                table: "room_queue_sets",
                column: "RoomId",
                principalTable: "Room",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Matches_Room_RoomId",
                table: "Matches");

            migrationBuilder.DropForeignKey(
                name: "FK_Room_users_LeaderId",
                table: "Room");

            migrationBuilder.DropForeignKey(
                name: "FK_Submissions_Matches_MatchId",
                table: "Submissions");

            migrationBuilder.DropForeignKey(
                name: "FK_Submissions_Matches_MatchId1",
                table: "Submissions");

            migrationBuilder.DropForeignKey(
                name: "FK_Submissions_participants_ParticipantId",
                table: "Submissions");

            migrationBuilder.DropForeignKey(
                name: "FK_Submissions_room_queue_phases_RoomQueuePhaseId",
                table: "Submissions");

            migrationBuilder.DropForeignKey(
                name: "FK_participants_Room_RoomId",
                table: "participants");

            migrationBuilder.DropForeignKey(
                name: "FK_room_queue_phases_Room_RoomId",
                table: "room_queue_phases");

            migrationBuilder.DropForeignKey(
                name: "FK_room_queue_sets_Room_RoomId",
                table: "room_queue_sets");

            migrationBuilder.DropPrimaryKey(
                name: "PK_Submissions",
                table: "Submissions");

            migrationBuilder.DropIndex(
                name: "IX_Submissions_MatchId1",
                table: "Submissions");

            migrationBuilder.DropPrimaryKey(
                name: "PK_Matches",
                table: "Matches");

            migrationBuilder.DropIndex(
                name: "IX_Matches_RoomId_Mode",
                table: "Matches");

            migrationBuilder.DropPrimaryKey(
                name: "PK_Room",
                table: "Room");

            migrationBuilder.DropIndex(
                name: "IX_Room_LeaderId",
                table: "Room");

            migrationBuilder.DropColumn(
                name: "MatchId1",
                table: "Submissions");

            migrationBuilder.DropColumn(
                name: "LeaderId",
                table: "Room");

            migrationBuilder.RenameTable(
                name: "Submissions",
                newName: "submissions");

            migrationBuilder.RenameTable(
                name: "Matches",
                newName: "matches");

            migrationBuilder.RenameTable(
                name: "Room",
                newName: "rooms");

            migrationBuilder.RenameIndex(
                name: "IX_Submissions_RoomQueuePhaseId",
                table: "submissions",
                newName: "IX_submissions_RoomQueuePhaseId");

            migrationBuilder.RenameIndex(
                name: "IX_Submissions_ParticipantId",
                table: "submissions",
                newName: "IX_submissions_ParticipantId");

            migrationBuilder.RenameIndex(
                name: "IX_Submissions_MatchId_RoomQueuePhaseId_ParticipantId",
                table: "submissions",
                newName: "IX_submissions_MatchId_RoomQueuePhaseId_ParticipantId");

            migrationBuilder.RenameIndex(
                name: "IX_Room_LeaderUserId",
                table: "rooms",
                newName: "IX_rooms_LeaderUserId");

            migrationBuilder.RenameIndex(
                name: "IX_Room_Code",
                table: "rooms",
                newName: "IX_rooms_Code");

            migrationBuilder.AlterColumn<string>(
                name: "TestsPassedJson",
                table: "submissions",
                type: "jsonb",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "text",
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "Grading",
                table: "submissions",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                oldClrType: typeof(int),
                oldType: "integer");

            migrationBuilder.AlterColumn<string>(
                name: "AnswerJson",
                table: "submissions",
                type: "jsonb",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "text");

            migrationBuilder.AlterColumn<string>(
                name: "AiSuggestionsJson",
                table: "submissions",
                type: "jsonb",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "text",
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "Status",
                table: "matches",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                oldClrType: typeof(int),
                oldType: "integer");

            migrationBuilder.AlterColumn<string>(
                name: "Mode",
                table: "matches",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                oldClrType: typeof(int),
                oldType: "integer");

            migrationBuilder.AlterColumn<string>(
                name: "Status",
                table: "rooms",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                oldClrType: typeof(int),
                oldType: "integer");

            migrationBuilder.AlterColumn<string>(
                name: "MatchMode",
                table: "rooms",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true,
                oldClrType: typeof(int),
                oldType: "integer",
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "Code",
                table: "rooms",
                type: "character varying(6)",
                maxLength: 6,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "text");

            migrationBuilder.AddPrimaryKey(
                name: "PK_submissions",
                table: "submissions",
                column: "Id");

            migrationBuilder.AddPrimaryKey(
                name: "PK_matches",
                table: "matches",
                column: "Id");

            migrationBuilder.AddPrimaryKey(
                name: "PK_rooms",
                table: "rooms",
                column: "Id");

            migrationBuilder.CreateIndex(
                name: "IX_submissions_MatchId_RoomQueuePhaseId_Score",
                table: "submissions",
                columns: new[] { "MatchId", "RoomQueuePhaseId", "Score" });

            migrationBuilder.CreateIndex(
                name: "IX_matches_RoomId",
                table: "matches",
                column: "RoomId");

            migrationBuilder.AddForeignKey(
                name: "FK_matches_rooms_RoomId",
                table: "matches",
                column: "RoomId",
                principalTable: "rooms",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_participants_rooms_RoomId",
                table: "participants",
                column: "RoomId",
                principalTable: "rooms",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_room_queue_phases_rooms_RoomId",
                table: "room_queue_phases",
                column: "RoomId",
                principalTable: "rooms",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_room_queue_sets_rooms_RoomId",
                table: "room_queue_sets",
                column: "RoomId",
                principalTable: "rooms",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_rooms_users_LeaderUserId",
                table: "rooms",
                column: "LeaderUserId",
                principalTable: "users",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_submissions_matches_MatchId",
                table: "submissions",
                column: "MatchId",
                principalTable: "matches",
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
