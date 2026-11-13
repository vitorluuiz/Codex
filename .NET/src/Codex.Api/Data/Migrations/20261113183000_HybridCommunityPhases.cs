using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Codex.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class HybridCommunityPhases : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "phases");

            migrationBuilder.DropTable(
                name: "phase_sets");

            migrationBuilder.CreateTable(
                name: "community_phases",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AuthorId = table.Column<Guid>(type: "uuid", nullable: false),
                    AuthorName = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    OriginPhaseId = table.Column<Guid>(type: "uuid", nullable: true),
                    SourceDraftPhaseId = table.Column<Guid>(type: "uuid", nullable: true),
                    Version = table.Column<int>(type: "integer", nullable: false),
                    Kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Subject = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Difficulty = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    Name = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    QuestionPreview = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    BasePoints = table.Column<int>(type: "integer", nullable: false),
                    PointsMultiplier = table.Column<decimal>(type: "numeric(5,2)", precision: 5, scale: 2, nullable: false),
                    TimeSeconds = table.Column<int>(type: "integer", nullable: false),
                    ContentJson = table.Column<string>(type: "jsonb", nullable: false),
                    ContentHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    UseCount = table.Column<long>(type: "bigint", nullable: false),
                    SubmissionsCount = table.Column<long>(type: "bigint", nullable: false),
                    CorrectSubmissionsCount = table.Column<long>(type: "bigint", nullable: false),
                    PublishedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_community_phases", x => x.Id);
                    table.ForeignKey(
                        name: "FK_community_phases_users_AuthorId",
                        column: x => x.AuthorId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_community_phases_AuthorId_PublishedAt",
                table: "community_phases",
                columns: new[] { "AuthorId", "PublishedAt" },
                descending: new[] { false, true });

            migrationBuilder.CreateIndex(
                name: "IX_community_phases_Catalog_Popular",
                table: "community_phases",
                columns: new[] { "Status", "Subject", "Kind", "UseCount" },
                descending: new[] { false, false, false, true });

            migrationBuilder.CreateIndex(
                name: "IX_community_phases_Catalog_Recent",
                table: "community_phases",
                columns: new[] { "Status", "Subject", "Kind", "PublishedAt" },
                descending: new[] { false, false, false, true });

            migrationBuilder.Sql(
                """CREATE INDEX "IX_community_phases_Search_Gin" ON community_phases USING gin (to_tsvector('portuguese', "Name" || ' ' || "QuestionPreview"));""");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "community_phases");

            migrationBuilder.CreateTable(
                name: "phase_sets",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Title = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    OwnerId = table.Column<Guid>(type: "uuid", nullable: false),
                    Visibility = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_phase_sets", x => x.Id);
                    table.ForeignKey(
                        name: "FK_phase_sets_users_OwnerId",
                        column: x => x.OwnerId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "phases",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PhaseSetId = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Name = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    BasePoints = table.Column<int>(type: "integer", nullable: false),
                    PointsMultiplier = table.Column<decimal>(type: "numeric(5,2)", precision: 5, scale: 2, nullable: false),
                    TimeSeconds = table.Column<int>(type: "integer", nullable: false),
                    OrderIndex = table.Column<int>(type: "integer", nullable: false),
                    ContentJson = table.Column<string>(type: "jsonb", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_phases", x => x.Id);
                    table.ForeignKey(
                        name: "FK_phases_phase_sets_PhaseSetId",
                        column: x => x.PhaseSetId,
                        principalTable: "phase_sets",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_phase_sets_OwnerId_UpdatedAt",
                table: "phase_sets",
                columns: new[] { "OwnerId", "UpdatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_phase_sets_Visibility_Title",
                table: "phase_sets",
                columns: new[] { "Visibility", "Title" });

            migrationBuilder.CreateIndex(
                name: "IX_phases_PhaseSetId_OrderIndex",
                table: "phases",
                columns: new[] { "PhaseSetId", "OrderIndex" });
        }
    }
}
