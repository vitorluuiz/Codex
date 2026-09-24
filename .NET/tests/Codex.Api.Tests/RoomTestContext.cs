using System.Security.Claims;
using Codex.Api.Common.Auth;
using Codex.Api.Common.Formatting;
using Codex.Api.Data;
using Codex.Api.Documents;
using Codex.Api.Domain;
using Codex.Api.Domain.Entities;
using Codex.Api.Services;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;

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
    public MatchService Matches { get; }
    public SubmissionService Submissions { get; }
    public MatchStatsService MatchStats { get; }
    public LabelFormatter Labels { get; }
    public ISessionTokenService Tokens { get; }

    /// <summary>
    /// O store de documentos em memoria. Enquanto durar a escrita dupla (passos 3 e 4 da secao 8.2
    /// da migracao-dados), e por aqui que um teste confere que o snapshot da partida encerrada bate
    /// com o que o Postgres calcula — a comparacao so e possivel enquanto os dois lados existem.
    /// </summary>
    public InMemoryMatchDocumentStore Documents { get; }

    public MatchDocumentWriter MatchDocuments { get; }

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

        Documents = new InMemoryMatchDocumentStore();
        var access = new RoomAccessService(Db);
        Labels = new LabelFormatter(configuration);
        Queue = new RoomQueueService(Db, access, Realtime);
        Rooms = new RoomService(Db, access, Queue, Labels, Realtime);
        Participants = new ParticipantService(Db, access, Rooms, Tokens, Realtime, configuration);
        Profiles = new UserProfileService(Db, Labels, Documents, new DocumentOptions());
        PhaseSets = new PhaseSetService(Db, Labels);

        var matchAccess = new MatchAccessService(Db);
        MatchStats = new MatchStatsService(Db);
        var matchEvents = new MatchEventPublisher(MatchStats, Realtime);
        MatchDocuments = new MatchDocumentWriter(Db, Documents, NullLogger<MatchDocumentWriter>.Instance);
        Matches = new MatchService(Db, access, matchAccess, MatchStats, matchEvents, MatchDocuments);
        Submissions = new SubmissionService(Db, matchAccess, Matches, MatchStats, matchEvents);

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

    /// <summary>
    /// Conjunto de uma fase so, com <c>kind</c> e conteudo escolhidos — para as rotas que de fato
    /// leem o <c>ContentJson</c> (o detalhe da fase da secao 6 e, depois, a partida da secao 7). A
    /// sobrecarga acima continua servindo quem so precisa de "N fases quaisquer".
    /// </summary>
    public PhaseSet AddPhaseSet(User owner, string title, PhaseKind kind, PhaseContent content, string phaseName = "Fase 1")
    {
        var set = new PhaseSet { Title = title, OwnerId = owner.Id, UpdatedAt = DateTimeOffset.UtcNow };
        Db.PhaseSets.Add(set);

        Db.Phases.Add(new Phase
        {
            PhaseSetId = set.Id,
            Kind = kind,
            Name = phaseName,
            BasePoints = 100,
            TimeSeconds = 45,
            OrderIndex = 0,
            ContentJson = content.ToJson(),
        });

        Db.SaveChanges();
        return set;
    }

    /// <summary>
    /// Conjunto de fases <b>completas</b> — o que a partida aceita comecar.
    ///
    /// Existe ao lado de <see cref="AddPhaseSet(User,string,int,PhaseSetVisibility,DateTimeOffset?)"/>
    /// em vez de substitui-lo porque aquele semeia de proposito uma fase <i>incompleta</i> (quiz sem
    /// alternativa nenhuma), que e o que as secoes 5 e 6 precisam testar: rascunho incompleto salva.
    /// A secao 7 e quem cobra fase completa, entao os testes dela precisam do outro caso.
    /// </summary>
    public PhaseSet AddPlayableSet(
        User owner,
        string title,
        int phaseCount = 2,
        int timeSeconds = 45,
        int basePoints = 100,
        IReadOnlyList<int>? correctIndexes = null)
    {
        var set = new PhaseSet { Title = title, OwnerId = owner.Id, UpdatedAt = DateTimeOffset.UtcNow };
        Db.PhaseSets.Add(set);

        var content = new PhaseContent(
            Question: "Qual fracao e equivalente a 2/3?",
            Options: ["4/6", "3/4", "5/6"],
            CorrectIndexes: correctIndexes ?? [0]);

        for (var index = 0; index < phaseCount; index++)
        {
            Db.Phases.Add(new Phase
            {
                PhaseSetId = set.Id,
                Kind = PhaseKind.Quiz,
                Name = $"Fase {index + 1}",
                BasePoints = basePoints,
                TimeSeconds = timeSeconds,
                OrderIndex = index,
                ContentJson = content.ToJson(),
            });
        }

        Db.SaveChanges();
        return set;
    }

    /// <summary>Enfileira o conjunto na sala, como o lider faria pelo lobby.</summary>
    public Task EnqueueAsync(PhaseSet set)
        => Queue.AddSetAsync(Room.Code, new Contracts.Rooms.AddQueueSetRequest(set.Id.ToString()), AsLeader, default);

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
