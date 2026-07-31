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

        builder.HasOne(s => s.RoomQueuePhase)
            .WithMany(p => p.Submissions)
            .HasForeignKey(s => s.RoomQueuePhaseId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(s => s.Participant)
            .WithMany(p => p.Submissions)
            .HasForeignKey(s => s.ParticipantId)
            .OnDelete(DeleteBehavior.Cascade);

        // Decisao 2 da secao 13: "1 envio por pessoa por fase" garantido pelo banco.
        builder.HasIndex(s => new { s.RoomQueuePhaseId, s.ParticipantId }).IsUnique();

        // Histograma/podio ordenam por score dentro da fase.
        builder.HasIndex(s => new { s.RoomQueuePhaseId, s.Score });
    }
}
