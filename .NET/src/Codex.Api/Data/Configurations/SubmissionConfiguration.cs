using Codex.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Codex.Api.Data.Configurations;

public class SubmissionConfiguration : IEntityTypeConfiguration<Submission>
{
    public void Configure(EntityTypeBuilder<Submission> builder)
    {
        builder.HasKey(s => s.Id);
        
        builder.HasOne(s => s.Match)
            .WithMany()
            .HasForeignKey(s => s.MatchId)
            .OnDelete(DeleteBehavior.Restrict);
            
        builder.HasIndex(s => new { s.MatchId, s.RoomQueuePhaseId, s.ParticipantId }).IsUnique();
    }
}
