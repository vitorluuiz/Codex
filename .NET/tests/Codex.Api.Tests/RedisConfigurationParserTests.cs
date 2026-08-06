using System.Net;
using Codex.Api.Services.Realtime;
using StackExchange.Redis;

namespace Codex.Api.Tests;

/// <summary>
/// A razao de ser destes testes esta no primeiro deles: <c>ConfigurationOptions.Parse</c> aceita
/// uma URL <c>redis://</c> sem reclamar e produz um endpoint invalido. Como o servico de WS
/// vizinho usa exatamente esse formato (ioredis), o valor errado e o que qualquer pessoa
/// copiaria — e o sintoma seria mudo.
/// </summary>
public class RedisConfigurationParserTests
{
    private static (string Host, int Port) Endpoint(ConfigurationOptions options)
    {
        var endpoint = Assert.Single(options.EndPoints);
        return endpoint switch
        {
            DnsEndPoint dns => (dns.Host, dns.Port),
            IPEndPoint ip => (ip.Address.ToString(), ip.Port),
            _ => throw new InvalidOperationException($"Endpoint inesperado: {endpoint.GetType().Name}"),
        };
    }

    [Fact]
    public void The_native_parser_silently_mangles_a_redis_url()
    {
        // Nao e teste do nosso codigo: e o registro do comportamento que motiva o parser. Se um
        // dia o StackExchange.Redis passar a entender URLs, este teste quebra e avisa que o
        // RedisConfigurationParser virou desnecessario.
        var mangled = ConfigurationOptions.Parse("redis://localhost:6379");

        // A URL inteira vira o nome do host, e a porta some. Nada disso lanca.
        var (host, port) = Endpoint(mangled);
        Assert.Equal("redis://localhost:6379", host);
        Assert.Equal(0, port);
    }

    [Fact]
    public void A_redis_url_resolves_to_host_and_port()
    {
        var (host, port) = Endpoint(RedisConfigurationParser.Parse("redis://localhost:6379"));

        Assert.Equal("localhost", host);
        Assert.Equal(6379, port);
    }

    [Fact]
    public void The_native_format_keeps_working()
    {
        var (host, port) = Endpoint(RedisConfigurationParser.Parse("localhost:6379"));

        Assert.Equal("localhost", host);
        Assert.Equal(6379, port);
    }

    [Fact]
    public void A_url_without_a_port_falls_back_to_6379()
    {
        var (_, port) = Endpoint(RedisConfigurationParser.Parse("redis://cache.interno"));

        Assert.Equal(6379, port);
    }

    [Fact]
    public void Rediss_asks_for_tls()
    {
        Assert.True(RedisConfigurationParser.Parse("rediss://cache.interno:6380").Ssl);
        Assert.False(RedisConfigurationParser.Parse("redis://cache.interno:6379").Ssl);
    }

    [Fact]
    public void A_password_only_userinfo_is_a_password_not_a_user()
    {
        // Forma classica, anterior ao ACL do Redis 6: redis://senha@host.
        var options = RedisConfigurationParser.Parse("redis://s3nha@cache.interno:6379");

        Assert.Equal("s3nha", options.Password);
        Assert.True(string.IsNullOrEmpty(options.User));
    }

    [Fact]
    public void User_and_password_are_split_and_unescaped()
    {
        var options = RedisConfigurationParser.Parse("redis://app:p%40ss%3Aword@cache.interno:6379");

        Assert.Equal("app", options.User);
        Assert.Equal("p@ss:word", options.Password);
    }

    [Fact]
    public void The_path_selects_the_database()
    {
        Assert.Equal(3, RedisConfigurationParser.Parse("redis://localhost:6379/3").DefaultDatabase);
        Assert.Null(RedisConfigurationParser.Parse("redis://localhost:6379").DefaultDatabase);
    }

    [Fact]
    public void Whitespace_around_the_value_does_not_break_it()
    {
        // Valor copiado de um .env costuma vir com espaco sobrando.
        var (host, port) = Endpoint(RedisConfigurationParser.Parse("  redis://localhost:6379  "));

        Assert.Equal("localhost", host);
        Assert.Equal(6379, port);
    }
}
