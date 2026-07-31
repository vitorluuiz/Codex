using Codex.Api.Domain.Entities;
using Microsoft.AspNetCore.DataProtection.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace Codex.Api.Data;

/// <summary>
/// Implementa IDataProtectionKeyContext para guardar as chaves de Data Protection no mesmo
/// Postgres (usadas para assinar/validar o token de sessao — ver SessionTokenService). Evita
/// depender de um key ring externo (Redis/Blob) so para isso caber numa base de projeto.
/// </summary>
public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options), IDataProtectionKeyContext
{
    public DbSet<User> Users => Set<User>();
    public DbSet<Room> Rooms => Set<Room>();
    public DbSet<Participant> Participants => Set<Participant>();
    public DbSet<PhaseSet> PhaseSets => Set<PhaseSet>();
    public DbSet<Phase> Phases => Set<Phase>();
    public DbSet<RoomQueueSet> RoomQueueSets => Set<RoomQueueSet>();
    public DbSet<RoomQueuePhase> RoomQueuePhases => Set<RoomQueuePhase>();
    public DbSet<Match> Matches => Set<Match>();
    public DbSet<Submission> Submissions => Set<Submission>();

    public DbSet<Microsoft.AspNetCore.DataProtection.EntityFrameworkCore.DataProtectionKey> DataProtectionKeys => Set<Microsoft.AspNetCore.DataProtection.EntityFrameworkCore.DataProtectionKey>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(AppDbContext).Assembly);
    }
}
