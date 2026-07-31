using Codex.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Codex.Api.Data.Configurations;

public class MatchConfiguration : IEntityTypeConfiguration<Match>
{
    public void Configure(EntityTypeBuilder<Match> builder)
    {
        builder.ToTable("matches");

        builder.Property(m => m.Mode).HasConversion<string>().HasMaxLength(16);
        builder.Property(m => m.Status).HasConversion<string>().HasMaxLength(16);

        builder.HasOne(m => m.Room)
            .WithMany(r => r.Matches)
            .HasForeignKey(m => m.RoomId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasIndex(m => m.RoomId);
    }
}
