using Codex.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Codex.Api.Data.Configurations;

public class AiGenerationConfiguration : IEntityTypeConfiguration<AiGeneration>
{
    public void Configure(EntityTypeBuilder<AiGeneration> builder)
    {
        builder.ToTable("ai_generations");

        builder.Property(g => g.Operation).HasConversion<string>().HasMaxLength(32).IsRequired();
        builder.Property(g => g.Kind).HasConversion<string>().HasMaxLength(16);
        builder.Property(g => g.Provider).HasMaxLength(32).IsRequired();
        builder.Property(g => g.Model).HasMaxLength(128).IsRequired();
        builder.Property(g => g.Status).HasConversion<string>().HasMaxLength(16).IsRequired();
        builder.Property(g => g.Decision).HasConversion<string>().HasMaxLength(16).IsRequired();
        builder.Property(g => g.InputJson).HasColumnType("jsonb").IsRequired();
        builder.Property(g => g.OutputJson).HasColumnType("jsonb");
        builder.Property(g => g.ErrorCode).HasMaxLength(64);

        builder.HasOne(g => g.User)
            .WithMany(u => u.AiGenerations)
            .HasForeignKey(g => g.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasIndex(g => new { g.UserId, g.CreatedAt })
            .IsDescending(false, true);
    }
}
