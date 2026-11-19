using System.Security.Claims;
using Codex.Api.Common.Auth;
using Codex.Api.Common.Formatting;
using Codex.Api.Data;
using Codex.Api.Documents;
using Codex.Api.Domain;
using Codex.Api.Domain.Entities;
using Codex.Api.Services;
using Codex.Api.Services.Redis;
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
    public InMemoryRoomRepository RoomRepo { get; }
    public InMemoryMatchRepository MatchRepo { get; }
    public InMemoryPhaseSetDocumentStore PhaseSetDocuments { get; }
    public RoomService Rooms { get; }
    public RoomQueueService Queue { get; }
    public ParticipantService Participants { get; }
    public UserProfileService Profiles { get; }
    public PhaseSetService PhaseSets { get; }
    public CommunityPhaseService CommunityPhases { get; }
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
        RoomRepo = new InMemoryRoomRepository();
        MatchRepo = new InMemoryMatchRepository();
        PhaseSetDocuments = new InMemoryPhaseSetDocumentStore();

        Tokens = new SessionTokenService(new EphemeralDataProtectionProvider());
        var configuration = new ConfigurationBuilder().Build();

        Documents = new InMemoryMatchDocumentStore();
        var access = new RoomAccessService(RoomRepo);
        Labels = new LabelFormatter(configuration);
        PhaseSets = new PhaseSetService(Db, PhaseSetDocuments, Labels);
        CommunityPhases = new CommunityPhaseService(Db);
        Queue = new RoomQueueService(Db, RoomRepo, access, Realtime, PhaseSets);
        Rooms = new RoomService(Db, RoomRepo, access, Queue, Labels, Realtime, PhaseSets);
        Participants = new ParticipantService(RoomRepo, access, Rooms, Tokens, Realtime, configuration);
        Profiles = new UserProfileService(Db, Labels, Documents, new DocumentOptions(), PhaseSetDocuments);

        var matchAccess = new MatchAccessService(RoomRepo, MatchRepo);
        MatchStats = new MatchStatsService(RoomRepo, MatchRepo);
        var matchEvents = new MatchEventPublisher(MatchStats, Realtime);
        MatchDocuments = new MatchDocumentWriter(RoomRepo, Documents, NullLogger<MatchDocumentWriter>.Instance, MatchRepo);
        Matches = new MatchService(access, matchAccess, MatchStats, matchEvents, MatchDocuments, RoomRepo, MatchRepo);
        Submissions = new SubmissionService(matchAccess, Matches, MatchStats, matchEvents, MatchRepo);

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
        Db.SaveChanges();

        var roomData = new RoomRedisData.RoomData(
            Id: Room.Id.ToString(),
            Code: Room.Code,
            Status: Room.Status.ToString().ToLowerInvariant(),
            MatchMode: Room.MatchMode?.ToString().ToLowerInvariant(),
            Capacity: Room.Capacity,
            Locked: Room.Locked,
            RequireAccount: Room.RequireAccount,
            LeaderUserId: Room.LeaderUserId.ToString(),
            LeaderName: Leader.Name,
            CreatedAtMs: Room.CreatedAt.ToUnixTimeMilliseconds(),
            ExpiresAtMs: Room.ExpiresAt?.ToUnixTimeMilliseconds(),
            QueueRevision: Room.QueueRevision,
            CurrentMatchId: Room.CurrentMatchId?.ToString());
        RoomRepo.ClaimCodeAndCreateAsync(Room.Code, roomData, CancellationToken.None).GetAwaiter().GetResult();
    }

    public ClaimsPrincipal Anonymous => new(new ClaimsIdentity());

    public ClaimsPrincipal AsLeader => AsUser(Leader.Id);

    public static ClaimsPrincipal AsUser(Guid userId)
        => new(new ClaimsIdentity([new Claim(CodexClaimTypes.UserId, userId.ToString())], "test"));

    public ClaimsPrincipal AsParticipant(Guid participantId)
        => new(new ClaimsIdentity(
            [new Claim(CodexClaimTypes.ParticipantId, participantId.ToString()), new Claim(CodexClaimTypes.RoomCode, Room.Code)],
            "test"));

    public ClaimsPrincipal AsParticipant(Guid participantId, Guid userId)
        => new(new ClaimsIdentity(
            [
                new Claim(CodexClaimTypes.UserId, userId.ToString()),
                new Claim(CodexClaimTypes.ParticipantId, participantId.ToString()),
                new Claim(CodexClaimTypes.RoomCode, Room.Code),
            ],
            "test"));

    /// <summary>Usuario qualquer que existe mas nao e o lider desta sala.</summary>
    public User AddUser(string name, string email)
    {
        var user = new User { Name = name, Email = email };
        Db.Users.Add(user);
        Db.SaveChanges();
        return user;
    }

    public sealed record SeededPhaseSet(
        Guid Id,
        string Title,
        Guid OwnerId,
        PhaseSetVisibility Visibility = PhaseSetVisibility.Private);

    /// <summary>Conjunto com N fases triviais — o conteudo por kind so importa a partir da secao 5.</summary>
    public SeededPhaseSet AddPhaseSet(
        User owner,
        string title,
        int phaseCount = 2,
        PhaseSetVisibility visibility = PhaseSetVisibility.Private,
        DateTimeOffset? updatedAt = null)
    {
        var timestamp = (updatedAt ?? DateTimeOffset.UtcNow).UtcDateTime;
        var incompleteContent = new PhaseContent(
            Question: "?",
            Options: [],
            CorrectIndexes: [0]);

        if (visibility == PhaseSetVisibility.Community)
        {
            var communityPhases = new List<CommunityPhase>(phaseCount);
            for (var index = 0; index < phaseCount; index++)
            {
                var name = $"Fase {index + 1}";
                var contentJson = incompleteContent.ToJson();
                var hash = PhaseContentHasher.Compute(PhaseKind.Quiz, name, 100, 1.0m, 45, incompleteContent);
                var cp = new CommunityPhase
                {
                    AuthorId = owner.Id,
                    AuthorName = owner.Name,
                    Kind = PhaseKind.Quiz,
                    Subject = "Geral",
                    Name = name,
                    QuestionPreview = PhaseContentHasher.BuildQuestionPreview(incompleteContent.Question),
                    BasePoints = 100,
                    PointsMultiplier = 1.00m,
                    TimeSeconds = 45,
                    ContentJson = contentJson,
                    ContentHash = hash,
                    Status = CommunityResourceStatus.Published,
                    PublishedAt = new DateTimeOffset(timestamp, TimeSpan.Zero),
                };
                communityPhases.Add(cp);
                Db.CommunityPhases.Add(cp);
            }

            Db.SaveChanges();

            var privateSetId = Guid.CreateVersion7();
            var communitySet = new CommunityPhaseSetDocument
            {
                SourcePrivateSetId = privateSetId,
                AuthorId = owner.Id,
                AuthorName = owner.Name,
                Title = title,
                Subject = "Geral",
                Status = CommunityResourceStatus.Published,
                PublishedAt = timestamp,
                PhaseIds = communityPhases.Select(p => p.Id).ToList(),
                Summary = PhaseSetSummarySubdocument.Compute(
                    communityPhases.Select(p => (p.Kind, p.TimeSeconds)).ToList()),
            };
            PhaseSetDocuments.InsertCommunitySetAsync(communitySet, CancellationToken.None).GetAwaiter().GetResult();

            var backingContentDoc = PhaseContentHasher.FromContent(incompleteContent);
            var backingPhases = communityPhases.Select((cp, idx) => new PrivatePhaseItemDocument
            {
                OriginCommunityPhaseId = cp.Id,
                ContentHash = cp.ContentHash,
                Kind = cp.Kind,
                Name = cp.Name,
                BasePoints = cp.BasePoints,
                PointsMultiplier = cp.PointsMultiplier,
                TimeSeconds = cp.TimeSeconds,
                OrderIndex = idx,
                Content = backingContentDoc,
            }).ToList();
            PhaseSetDocuments.UpsertPrivateSetAsync(new PrivatePhaseSetDocument
            {
                Id = privateSetId,
                OwnerId = owner.Id,
                Title = title,
                Subject = "Geral",
                CreatedAt = timestamp,
                UpdatedAt = timestamp,
                PublishedSetId = communitySet.Id,
                PublishedVersion = 1,
                Phases = backingPhases,
                Summary = PhaseSetSummarySubdocument.Compute(
                    backingPhases.Select(p => (p.Kind, p.TimeSeconds)).ToList()),
            }, CancellationToken.None).GetAwaiter().GetResult();

            return new SeededPhaseSet(communitySet.Id, communitySet.Title, communitySet.AuthorId, PhaseSetVisibility.Community);
        }

        var phases = new List<PrivatePhaseItemDocument>(phaseCount);
        var contentDoc = PhaseContentHasher.FromContent(incompleteContent);
        for (var index = 0; index < phaseCount; index++)
        {
            var name = $"Fase {index + 1}";
            phases.Add(new PrivatePhaseItemDocument
            {
                Kind = PhaseKind.Quiz,
                Name = name,
                BasePoints = 100,
                PointsMultiplier = 1.0m,
                TimeSeconds = 45,
                OrderIndex = index,
                Content = contentDoc,
                ContentHash = PhaseContentHasher.Compute(PhaseKind.Quiz, name, 100, 1.0m, 45, incompleteContent),
            });
        }

        var privateSet = new PrivatePhaseSetDocument
        {
            OwnerId = owner.Id,
            Title = title,
            CreatedAt = timestamp,
            UpdatedAt = timestamp,
            Phases = phases,
            Summary = PhaseSetSummarySubdocument.Compute(
                phases.Select(p => (p.Kind, p.TimeSeconds)).ToList()),
        };
        PhaseSetDocuments.UpsertPrivateSetAsync(privateSet, CancellationToken.None).GetAwaiter().GetResult();
        return new SeededPhaseSet(privateSet.Id, privateSet.Title, privateSet.OwnerId, PhaseSetVisibility.Private);
    }

    /// <summary>
    /// Conjunto de uma fase so, com <c>kind</c> e conteudo escolhidos — para as rotas que de fato
    /// leem o <c>ContentJson</c> (o detalhe da fase da secao 6 e, depois, a partida da secao 7). A
    /// sobrecarga acima continua servindo quem so precisa de "N fases quaisquer".
    /// </summary>
    public SeededPhaseSet AddPhaseSet(User owner, string title, PhaseKind kind, PhaseContent content, string phaseName = "Fase 1")
    {
        var now = DateTime.UtcNow;
        var item = new PrivatePhaseItemDocument
        {
            Kind = kind,
            Name = phaseName,
            BasePoints = 100,
            PointsMultiplier = 1.0m,
            TimeSeconds = 45,
            OrderIndex = 0,
            Content = PhaseContentHasher.FromContent(content),
            ContentHash = PhaseContentHasher.Compute(kind, phaseName, 100, 1.0m, 45, content),
        };

        var privateSet = new PrivatePhaseSetDocument
        {
            OwnerId = owner.Id,
            Title = title,
            CreatedAt = now,
            UpdatedAt = now,
            Phases = [item],
            Summary = PhaseSetSummarySubdocument.Compute([(kind, 45)]),
        };
        PhaseSetDocuments.UpsertPrivateSetAsync(privateSet, CancellationToken.None).GetAwaiter().GetResult();
        return new SeededPhaseSet(privateSet.Id, privateSet.Title, privateSet.OwnerId, PhaseSetVisibility.Private);
    }

    /// <summary>
    /// Conjunto de fases <b>completas</b> — o que a partida aceita comecar.
    ///
    /// Existe ao lado de <see cref="AddPhaseSet(User,string,int,PhaseSetVisibility,DateTimeOffset?)"/>
    /// em vez de substitui-lo porque aquele semeia de proposito uma fase <i>incompleta</i> (quiz sem
    /// alternativa nenhuma), que e o que as secoes 5 e 6 precisam testar: rascunho incompleto salva.
    /// A secao 7 e quem cobra fase completa, entao os testes dela precisam do outro caso.
    /// </summary>
    public SeededPhaseSet AddPlayableSet(
        User owner,
        string title,
        int phaseCount = 2,
        int timeSeconds = 45,
        int basePoints = 100,
        IReadOnlyList<int>? correctIndexes = null)
    {
        var now = DateTime.UtcNow;
        var content = new PhaseContent(
            Question: "Qual fracao e equivalente a 2/3?",
            Options: ["4/6", "3/4", "5/6"],
            CorrectIndexes: correctIndexes ?? [0]);
        var contentDoc = PhaseContentHasher.FromContent(content);

        var phases = new List<PrivatePhaseItemDocument>(phaseCount);
        for (var index = 0; index < phaseCount; index++)
        {
            var name = $"Fase {index + 1}";
            phases.Add(new PrivatePhaseItemDocument
            {
                Kind = PhaseKind.Quiz,
                Name = name,
                BasePoints = basePoints,
                PointsMultiplier = 1.0m,
                TimeSeconds = timeSeconds,
                OrderIndex = index,
                Content = contentDoc,
                ContentHash = PhaseContentHasher.Compute(PhaseKind.Quiz, name, basePoints, 1.0m, timeSeconds, content),
            });
        }

        var privateSet = new PrivatePhaseSetDocument
        {
            OwnerId = owner.Id,
            Title = title,
            CreatedAt = now,
            UpdatedAt = now,
            Phases = phases,
            Summary = PhaseSetSummarySubdocument.Compute(
                phases.Select(p => (p.Kind, p.TimeSeconds)).ToList()),
        };
        PhaseSetDocuments.UpsertPrivateSetAsync(privateSet, CancellationToken.None).GetAwaiter().GetResult();
        return new SeededPhaseSet(privateSet.Id, privateSet.Title, privateSet.OwnerId, PhaseSetVisibility.Private);
    }

    /// <summary>Enfileira o conjunto na sala, como o lider faria pelo lobby.</summary>
    public Task EnqueueAsync(SeededPhaseSet set)
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
        var data = new RoomRedisData.ParticipantData(
            Id: participant.Id.ToString(),
            DisplayName: participant.DisplayName,
            AvatarIndex: participant.AvatarIndex,
            LoggedIn: participant.LoggedIn,
            UserId: participant.UserId?.ToString(),
            Status: participant.Status.ToString().ToLowerInvariant(),
            JoinedAtMs: participant.JoinedAt.ToUnixTimeMilliseconds(),
            InResultsSinceMs: participant.InResultsSince?.ToUnixTimeMilliseconds());

        RoomRepo.JoinParticipantAsync(Room.Id.ToString(), Room.Capacity, data, CancellationToken.None).GetAwaiter().GetResult();
        if (status == ParticipantStatus.Rejected)
        {
            RoomRepo.RejectParticipantAsync(
                Room.Id.ToString(),
                data.Id,
                participant.DisplayName.ToLowerInvariant(),
                data,
                CancellationToken.None).GetAwaiter().GetResult();
        }
        else if (userId is not null)
        {
            RoomRepo.AddToJoinedAsync(userId.Value.ToString(), Room.Id.ToString(), CancellationToken.None).GetAwaiter().GetResult();
        }

        return participant;
    }
}
