using System.Security.Claims;
using Codex.Api.Common.Auth;
using Codex.Api.Common.Errors;
using Codex.Api.Common.Realtime;
using Codex.Api.Contracts.Realtime;
using Codex.Api.Contracts.Rooms;
using Codex.Api.Data;
using Codex.Api.Data.Configurations;
using Codex.Api.Domain;
using Codex.Api.Domain.Entities;
using Codex.Api.Services.Realtime;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Codex.Api.Services;

/// <summary>
/// api-rest.md secao 3 (POST /rooms/{code}/participants) e a parte de participantes da secao 4
/// (listar, aprovar, recusar, remover).
/// </summary>
public class ParticipantService(
    AppDbContext db,
    RoomAccessService roomAccess,
    RoomService roomService,
    ISessionTokenService tokenService,
    IRealtimeEventPublisher realtime,
    IConfiguration configuration)
{
    private const int MaxDisplayNameLength = 80;

    public async Task<JoinRoomResponse> JoinAsync(string code, JoinRoomRequest request, ClaimsPrincipal principal, CancellationToken ct)
    {
        var displayName = (request.DisplayName ?? string.Empty).Trim();
        if (displayName.Length is 0 or > MaxDisplayNameLength)
        {
            throw new ApiException(StatusCodes.Status400BadRequest, ErrorCodes.ValidationError, $"displayName deve ter entre 1 e {MaxDisplayNameLength} caracteres.");
        }

        if (request.AvatarIndex < 0)
        {
            throw new ApiException(StatusCodes.Status400BadRequest, ErrorCodes.ValidationError, "avatarIndex deve ser maior ou igual a zero.");
        }

        var room = await roomAccess.GetActiveRoomAsync(code, ct);
        var userId = principal.GetUserId();

        // Reentrada de quem tem conta: o mesmo usuario voltando para a mesma sala reassume o
        // participante que ja tem, em vez de esbarrar em USERNAME_TAKEN com o proprio nome ou
        // criar um segundo card no lobby. Convidado nao tem identidade estavel entre requests,
        // entao para ele nao existe reentrada — recarregar e sempre um participante novo.
        var existing = userId is null
            ? null
            : await db.Participants.FirstOrDefaultAsync(
                p => p.RoomId == room.Id && p.UserId == userId && p.Status != ParticipantStatus.Rejected, ct);

        if (existing is null)
        {
            await roomService.EnsureJoinableAsync(room, principal, ct);
        }

        await EnsureDisplayNameFreeAsync(room.Id, displayName, existing?.Id, ct);

        var participant = existing ?? new Participant
        {
            RoomId = room.Id,
            DisplayName = displayName,
            UserId = userId,
            // "O participante nasce pending. Quem aprova e o lider" (secao 3) — vale tambem
            // para quem tem conta: ter login nao e o mesmo que ter sido aceito nesta sala.
            Status = ParticipantStatus.Pending,
        };

        participant.DisplayName = displayName;
        participant.AvatarIndex = request.AvatarIndex;
        participant.LoggedIn = userId is not null;

        if (existing is null)
        {
            db.Participants.Add(participant);
        }

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex) when (IsDuplicateDisplayName(ex))
        {
            throw UsernameTaken();
        }

        var lifetime = TimeSpan.FromHours(configuration.GetValue("CodexApi:GuestParticipantLifetimeHours", 4));
        var expiresAt = DateTimeOffset.UtcNow.Add(lifetime);
        var token = tokenService.Issue(new SessionTokenPayload(userId, participant.Id, room.Code, expiresAt));

        // Reentrada nao e uma chegada: o card ja esta na tela do lider, e mandar "joined" faria
        // o front decidir entre inserir e atualizar por conta propria.
        var dto = ToDto(participant);
        await realtime.PublishAsync(
            room.Code,
            RealtimeChannels.Room(room.Code),
            existing is null ? new ParticipantJoinedEvent(dto) : (object)new ParticipantUpdatedEvent(dto),
            ct);

        return new JoinRoomResponse(dto, token, (int)lifetime.TotalSeconds);
    }

    /// <summary>
    /// GET /rooms/{code}/participants?status=approved|pending (secao 4). Sem "status" assume
    /// "approved": e o que o lobby do jogador pede, e e o unico valor que qualquer membro pode
    /// ver — um default que vaza a fila de espera seria a falha errada de se ter.
    /// </summary>
    public async Task<IReadOnlyList<ParticipantDto>> ListAsync(string code, string? status, ClaimsPrincipal principal, CancellationToken ct)
    {
        var requested = string.IsNullOrWhiteSpace(status) ? "approved" : status.Trim().ToLowerInvariant();

        var parsed = requested switch
        {
            "approved" => ParticipantStatus.Approved,
            "pending" => ParticipantStatus.Pending,
            _ => throw new ApiException(StatusCodes.Status400BadRequest, ErrorCodes.ValidationError, "status deve ser 'approved' ou 'pending'."),
        };

        var room = parsed is ParticipantStatus.Pending
            ? await roomAccess.GetRoomAsLeaderAsync(code, principal, ct)
            : await roomAccess.GetRoomAsMemberAsync(code, principal, ct);

        var participants = await db.Participants
            .AsNoTracking()
            .Where(p => p.RoomId == room.Id && p.Status == parsed)
            .OrderBy(p => p.JoinedAt)
            .ToListAsync(ct);

        return participants.Select(ToDto).ToList();
    }

    public async Task ApproveAsync(string code, Guid participantId, ClaimsPrincipal principal, CancellationToken ct)
    {
        var room = await roomAccess.GetRoomAsLeaderAsync(code, principal, ct);
        var participant = await FindInRoomAsync(room.Id, participantId, ct);

        // "Se requireAccount esta ligado, approve de um participante com loggedIn: false deve
        // responder 403 ACCOUNT_REQUIRED (a UI ja desabilita o botao, mas a checagem tem que
        // existir no servidor)" — secao 4. Alcancavel de verdade: da para entrar como convidado
        // e o lider ligar requireAccount depois.
        if (room.RequireAccount && !participant.LoggedIn)
        {
            throw new ApiException(StatusCodes.Status403Forbidden, ErrorCodes.AccountRequired, "Esta sala exige uma conta; este participante entrou sem conta.");
        }

        // Recusado nao ocupa vaga, entao readmiti-lo pode estourar a capacidade — os demais
        // caminhos ja contam o participante antes de aprovar e nao precisam desta checagem.
        if (participant.Status is ParticipantStatus.Rejected
            && await roomService.CountOccupancyAsync(room.Id, ct) >= room.Capacity)
        {
            throw new ApiException(StatusCodes.Status409Conflict, ErrorCodes.RoomFull, "A sala atingiu a capacidade maxima.");
        }

        participant.Status = ParticipantStatus.Approved;
        await db.SaveChangesAsync(ct);

        // Depois do SaveChanges, nunca antes: publicar primeiro entregaria ao lobby um estado
        // que ainda pode nao existir se a transacao falhar.
        await realtime.PublishAsync(
            room.Code,
            RealtimeChannels.Room(room.Code),
            new ParticipantUpdatedEvent(ToDto(participant)),
            ct);
    }

    public async Task RejectAsync(string code, Guid participantId, ClaimsPrincipal principal, CancellationToken ct)
    {
        var room = await roomAccess.GetRoomAsLeaderAsync(code, principal, ct);
        var participant = await FindInRoomAsync(room.Id, participantId, ct);

        participant.Status = ParticipantStatus.Rejected;
        await db.SaveChangesAsync(ct);

        await realtime.PublishAsync(
            room.Code,
            RealtimeChannels.Room(room.Code),
            new ParticipantUpdatedEvent(ToDto(participant)),
            ct);
    }

    public async Task RemoveAsync(string code, Guid participantId, ClaimsPrincipal principal, CancellationToken ct)
    {
        var room = await roomAccess.GetRoomAsLeaderAsync(code, principal, ct);
        var participant = await FindInRoomAsync(room.Id, participantId, ct);

        db.Participants.Remove(participant);
        await db.SaveChangesAsync(ct);

        // Dois eventos para a mesma acao, em canais diferentes e por motivos diferentes:
        //
        // - "participant.left" no canal da sala tira o card da lista de todo mundo;
        // - "participant.removed" no canal privado e o que faz a pessoa saber que foi ela, e o
        //   que leva o servico de WS a fechar o socket dela (secao 10: "so mandar o evento
        //   deixa a conexao viva recebendo eventos da sala").
        await realtime.PublishAsync(
            room.Code,
            RealtimeChannels.Room(room.Code),
            new ParticipantLeftEvent(participant.Id),
            ct);

        await realtime.PublishAsync(
            room.Code,
            RealtimeChannels.Participant(participant.Id),
            new ParticipantRemovedEvent("removed_by_leader"),
            ct);
    }

    /// <summary>
    /// 404 (e nao 403) quando o id existe mas em outra sala: para o lider desta sala, um
    /// participante de outra sala simplesmente nao existe.
    /// </summary>
    private async Task<Participant> FindInRoomAsync(Guid roomId, Guid participantId, CancellationToken ct)
    {
        var participant = await db.Participants.FirstOrDefaultAsync(p => p.Id == participantId && p.RoomId == roomId, ct);
        return participant ?? throw new ApiException(StatusCodes.Status404NotFound, ErrorCodes.ParticipantNotFound, "Participante nao encontrado nesta sala.");
    }

    /// <summary>
    /// Comparacao sem diferenciar maiusculas: "Ana" e "ana" na mesma lista sao dois cards que o
    /// lider nao consegue distinguir, que e exatamente o que USERNAME_TAKEN existe para evitar.
    /// Recusados sao ignorados — o nome deles volta a ficar livre.
    /// </summary>
    private async Task EnsureDisplayNameFreeAsync(Guid roomId, string displayName, Guid? ignoreParticipantId, CancellationToken ct)
    {
        var normalized = displayName.ToLowerInvariant();
        var taken = await db.Participants.AnyAsync(
            p => p.RoomId == roomId
                 && p.Status != ParticipantStatus.Rejected
                 && p.Id != ignoreParticipantId
                 && p.DisplayName.ToLower() == normalized,
            ct);

        if (taken)
        {
            throw UsernameTaken();
        }
    }

    /// <summary>
    /// A checagem acima e um SELECT seguido de um INSERT — duas pessoas mandando o mesmo nome no
    /// mesmo instante passam pelas duas. O indice unico parcial em participants e quem decide de
    /// fato; isto so traduz a violacao dele de volta para USERNAME_TAKEN, olhando o nome da
    /// constraint para nao confundir com qualquer outra unicidade da tabela.
    /// </summary>
    private static bool IsDuplicateDisplayName(DbUpdateException exception)
        => exception.InnerException is PostgresException
        {
            SqlState: PostgresErrorCodes.UniqueViolation,
            ConstraintName: ParticipantConfiguration.UniqueDisplayNamePerRoomIndex,
        };

    private static ApiException UsernameTaken()
        => new(StatusCodes.Status409Conflict, ErrorCodes.UsernameTaken, "Ja existe alguem com este nome na sala.");

    public static ParticipantDto ToDto(Participant participant) => new(
        participant.Id,
        participant.RoomId,
        participant.DisplayName,
        participant.AvatarIndex,
        participant.LoggedIn,
        participant.UserId,
        participant.Status,
        participant.JoinedAt);
}
