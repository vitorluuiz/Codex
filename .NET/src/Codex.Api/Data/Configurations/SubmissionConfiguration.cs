using Codex.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Codex.Api.Data.Configurations;

public class SubmissionConfiguration : IEntityTypeConfiguration<Submission>
{
    public void Configure(EntityTypeBuilder<Submission> builder)
    {
        builder.ToTable("submissions");

        builder.Property(s => s.Grading).HasConversion<string>().HasMaxLength(16);
        builder.Property(s => s.AnswerJson).HasColumnType("jsonb").IsRequired();
        builder.Property(s => s.AiSuggestionsJson).HasColumnType("jsonb");
        builder.Property(s => s.TestsPassedJson).HasColumnType("jsonb");

        builder.HasOne(s => s.Match)
            .WithMany(m => m.Submissions)
            .HasForeignKey(s => s.MatchId)
            .OnDelete(DeleteBehavior.Cascade);

        // Indices
        builder.HasIndex(s => new { s.MatchId, s.RoomQueuePhaseId, s.ParticipantId }).IsUnique();
        builder.HasIndex(s => new { s.MatchId, s.RoomQueuePhaseId, s.Score });
    }
}
