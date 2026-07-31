using Codex.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Codex.Api.Data.Configurations;

public class PhaseConfiguration : IEntityTypeConfiguration<Phase>
{
    public void Configure(EntityTypeBuilder<Phase> builder)
    {
        builder.ToTable("phases");

        builder.Property(p => p.Kind).HasConversion<string>().HasMaxLength(16);
        builder.Property(p => p.Name).HasMaxLength(160).IsRequired();
        builder.Property(p => p.PointsMultiplier).HasPrecision(5, 2);
        builder.Property(p => p.ContentJson).HasColumnType("jsonb").IsRequired();

        builder.HasOne(p => p.PhaseSet)
            .WithMany(s => s.Phases)
            .HasForeignKey(p => p.PhaseSetId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasIndex(p => new { p.PhaseSetId, p.OrderIndex });
    }
}
