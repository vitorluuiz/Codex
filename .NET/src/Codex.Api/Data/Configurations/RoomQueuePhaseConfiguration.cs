using Codex.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Codex.Api.Data.Configurations;

public class RoomQueuePhaseConfiguration : IEntityTypeConfiguration<RoomQueuePhase>
{
    public void Configure(EntityTypeBuilder<RoomQueuePhase> builder)
    {
        builder.ToTable("room_queue_phases");

        builder.Property(p => p.Kind).HasConversion<string>().HasMaxLength(16);
        builder.Property(p => p.Name).HasMaxLength(160).IsRequired();
        builder.Property(p => p.PointsMultiplier).HasPrecision(5, 2);
        builder.Property(p => p.ContentJson).HasColumnType("jsonb").IsRequired();

        builder.HasOne(p => p.Room)
            .WithMany(r => r.QueuePhases)
            .HasForeignKey(p => p.RoomId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(p => p.RoomQueueSet)
            .WithMany(s => s.Phases)
            .HasForeignKey(p => p.RoomQueueSetId)
            .OnDelete(DeleteBehavior.Cascade);

        // PUT /queue/order reordena por essa fila inteira; GET /queue le tudo ordenado.
        builder.HasIndex(p => new { p.RoomId, p.OrderIndex });
    }
}
