using Codex.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Codex.Api.Data.Configurations;

public class RoomQueueSetConfiguration : IEntityTypeConfiguration<RoomQueueSet>
{
    public void Configure(EntityTypeBuilder<RoomQueueSet> builder)
    {
        builder.ToTable("room_queue_sets");

        builder.Property(s => s.Title).HasMaxLength(160).IsRequired();
        builder.Property(s => s.Color).HasMaxLength(32).IsRequired();

        builder.HasOne(s => s.Room)
            .WithMany(r => r.QueueSets)
            .HasForeignKey(s => s.RoomId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasIndex(s => new { s.RoomId, s.OrderIndex });
    }
}
