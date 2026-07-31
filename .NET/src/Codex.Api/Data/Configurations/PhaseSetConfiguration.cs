using Codex.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Codex.Api.Data.Configurations;

public class PhaseSetConfiguration : IEntityTypeConfiguration<PhaseSet>
{
    public void Configure(EntityTypeBuilder<PhaseSet> builder)
    {
        builder.ToTable("phase_sets");

        builder.Property(s => s.Title).HasMaxLength(160).IsRequired();
        builder.Property(s => s.Visibility).HasConversion<string>().HasMaxLength(16);

        builder.HasOne(s => s.Owner)
            .WithMany(u => u.PhaseSets)
            .HasForeignKey(s => s.OwnerId)
            .OnDelete(DeleteBehavior.Cascade);

        // Aba "Meus conjuntos" (scope=owned).
        builder.HasIndex(s => new { s.OwnerId, s.UpdatedAt });
        // Aba "Comunidade" + busca (scope=community&q=).
        builder.HasIndex(s => new { s.Visibility, s.Title });
    }
}
