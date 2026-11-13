using Codex.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Codex.Api.Data.Configurations;

public class CommunityPhaseConfiguration : IEntityTypeConfiguration<CommunityPhase>
{
    public void Configure(EntityTypeBuilder<CommunityPhase> builder)
    {
        builder.ToTable("community_phases");

        builder.HasKey(p => p.Id);

        builder.Property(p => p.AuthorName).HasMaxLength(120).IsRequired();
        builder.Property(p => p.Kind).HasConversion<string>().HasMaxLength(16).IsRequired();
        builder.Property(p => p.Subject).HasMaxLength(64).IsRequired();
        builder.Property(p => p.Difficulty).HasConversion<string>().HasMaxLength(16);
        builder.Property(p => p.Name).HasMaxLength(160).IsRequired();
        builder.Property(p => p.QuestionPreview).HasMaxLength(300).IsRequired();
        builder.Property(p => p.PointsMultiplier).HasPrecision(5, 2);
        builder.Property(p => p.ContentJson).HasColumnType("jsonb").IsRequired();
        builder.Property(p => p.ContentHash).HasMaxLength(64).IsRequired();
        builder.Property(p => p.Status).HasConversion<string>().HasMaxLength(16).IsRequired();

        builder.HasOne(p => p.Author)
            .WithMany(u => u.CommunityPhases)
            .HasForeignKey(p => p.AuthorId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasIndex(p => new { p.Status, p.Subject, p.Kind, p.UseCount })
            .IsDescending(false, false, false, true)
            .HasDatabaseName("IX_community_phases_Catalog_Popular");

        builder.HasIndex(p => new { p.Status, p.Subject, p.Kind, p.PublishedAt })
            .IsDescending(false, false, false, true)
            .HasDatabaseName("IX_community_phases_Catalog_Recent");

        builder.HasIndex(p => new { p.AuthorId, p.PublishedAt })
            .IsDescending(false, true)
            .HasDatabaseName("IX_community_phases_AuthorId_PublishedAt");
    }
}
