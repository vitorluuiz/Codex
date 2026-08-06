using System.Security.Claims;
using Codex.Api.Common.Auth;
using Codex.Api.Common.Formatting;
using Codex.Api.Data;
using Codex.Api.Domain;
using Codex.Api.Domain.Entities;
using Codex.Api.Services;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace Codex.Api.Tests;

/// <summary>
/// Cenario minimo das secoes 3-4: uma sala com lider. Usa EF InMemory, como os testes de auth.
/// Consequencia: o indice unico parcial de nome por sala nao e exercitado aqui (InMemory nao
/// tem indices) — o que estes testes cobrem e a checagem do servico. A constraint em si foi
/// verificada contra o Postgres real.
/// </summary>
public class RoomTestContext
{
    public AppDbContext Db { get; }
    public RoomService Rooms { get; }
    public RoomQueueService Queue { get; }
    public ParticipantService Participants { get; }
    public UserProfileService Profiles { get; }
    public PhaseSetService PhaseSets { get; }
    public LabelFormatter Labels { get; }
    public ISessionTokenService Tokens { get; }

    /// <summary>
    /// Substituto do broker. Nos testes ele nao e so um no-op: e o unico jeito de afirmar que a
    /// mutacao publicou o evento certo, no canal certo — se so verificassemos o banco, uma
    /// publicacao esquecida passaria despercebida ate alguem abrir dois browsers.
    /// </summary>
    public RecordingRealtimePublisher Realtime { get; } = new();

    public User Leader { get; }
    public Room Room { get; }

    public RoomTestContext(Action<Room>? configureRoom = null)
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        Db = new AppDbContext(options);

        Tokens = new SessionTokenService(new EphemeralDataProtectionProvider());
        var configuration = new ConfigurationBuilder().Build();

        var access = new RoomAccessService(Db);
        Queue = new RoomQueueService(Db, access);
        Rooms = new RoomService(Db, access, Queue, Realtime);
        Participants = new ParticipantService(Db, access, Rooms, Tokens, Realtime, configuration);
        Labels = new LabelFormatter(configuration);
        Profiles = new UserProfileService(Db, Labels);
        PhaseSets = new PhaseSetService(Db, Labels);

        Leader = new User { Name = "Marina Duarte", Email = "marina@escola.br" };
        Room = new Room
        {
            Code = "482913",
            Capacity = 20,
            LeaderUserId = Leader.Id,
            Leader = Leader,
        };
        configureRoom?.Invoke(Room);

        Db.Users.Add(Leader);
        Db.Rooms.Add(Room);
        Db.SaveChanges();
    }

    public ClaimsPrincipal Anonymous => new(new ClaimsIdentity());

    public ClaimsPrincipal AsLeader => AsUser(Leader.Id);

    public static ClaimsPrincipal AsUser(Guid userId)
        => new(new ClaimsIdentity([new Claim(CodexClaimTypes.UserId, userId.ToString())], "test"));

    public ClaimsPrincipal AsParticipant(Guid participantId)
        => new(new ClaimsIdentity(
            [new Claim(CodexClaimTypes.ParticipantId, participantId.ToString()), new Claim(CodexClaimTypes.RoomCode, Room.Code)],
            "test"));

    /// <summary>Usuario qualquer que existe mas nao e o lider desta sala.</summary>
    public User AddUser(string name, string email)
    {
        var user = new User { Name = name, Email = email };
        Db.Users.Add(user);
        Db.SaveChanges();
        return user;
    }

    /// <summary>Conjunto com N fases triviais — o conteudo por kind so importa a partir da secao 5.</summary>
    public PhaseSet AddPhaseSet(
        User owner,
        string title,
        int phaseCount = 2,
        PhaseSetVisibility visibility = PhaseSetVisibility.Private,
        DateTimeOffset? updatedAt = null)
    {
        var set = new PhaseSet
        {
            Title = title,
            OwnerId = owner.Id,
            Visibility = visibility,
            UpdatedAt = updatedAt ?? DateTimeOffset.UtcNow,
        };
        Db.PhaseSets.Add(set);

        for (var index = 0; index < phaseCount; index++)
        {
            Db.Phases.Add(new Phase
            {
                PhaseSetId = set.Id,
                Kind = PhaseKind.Quiz,
                Name = $"Fase {index + 1}",
                BasePoints = 100,
                TimeSeconds = 45,
                OrderIndex = index,
                ContentJson = """{"question":"?","options":[],"correctIndexes":[0]}""",
            });
        }

        Db.SaveChanges();
        return set;
    }

    public Participant AddParticipant(string displayName, ParticipantStatus status = ParticipantStatus.Approved, Guid? userId = null)
    {
        var participant = new Participant
        {
            RoomId = Room.Id,
            DisplayName = displayName,
            Status = status,
            UserId = userId,
            LoggedIn = userId is not null,
        };
        Db.Participants.Add(participant);
        Db.SaveChanges();
        return participant;
    }
}
