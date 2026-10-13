<?php

namespace App\Services;

use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use RuntimeException;

/**
 * A tiny client for the cheapabase gateway.
 *
 * Auth goes to GoTrue (/auth/v1), data to PostgREST (/rest/v1) and code to
 * /functions/v1. The signed-in user's tokens live in the Laravel session;
 * every data call sends the anon key plus the user's JWT so RLS decides
 * what they can see. The service key is never used.
 */
class Cheapabase
{
    private const SESSION_KEY = 'cheapabase';

    public function url(): string
    {
        return config('services.cheapabase.url');
    }

    /** The anon key isn't configured anywhere: the gateway publishes it at /config.json. */
    public function anonKey(): string
    {
        return Cache::remember('cheapabase.anon_key', now()->addHour(), fn () => Http::get($this->url().'/config.json')
            ->throw()
            ->json('anonKey'));
    }

    // --- auth -------------------------------------------------------------

    public function signUp(string $email, string $password): void
    {
        $this->startSession($this->auth()->post('/signup', compact('email', 'password')));
    }

    public function signIn(string $email, string $password): void
    {
        $this->startSession($this->auth()->post('/token?grant_type=password', compact('email', 'password')));
    }

    public function signOut(): void
    {
        if ($token = session(self::SESSION_KEY.'.access_token')) {
            $this->auth()->withToken($token)->post('/logout');
        }
        session()->forget(self::SESSION_KEY);
    }

    public function user(): ?array
    {
        if (! $token = $this->accessToken()) {
            return null;
        }
        // Sessions created by the original example only stored email.
        if (! session(self::SESSION_KEY.'.user_id')) {
            $user = $this->auth()->withToken($token)->get('/user')->throw()->json();
            session()->put(self::SESSION_KEY.'.user_id', $user['id']);
        }

        return [
            'id' => session(self::SESSION_KEY.'.user_id'),
            'email' => session(self::SESSION_KEY.'.email'),
        ];
    }

    /** The user's access token, refreshed first if it has (nearly) expired. Null when signed out. */
    public function accessToken(): ?string
    {
        $session = session(self::SESSION_KEY);
        if (! $session) {
            return null;
        }

        if ($session['expires_at'] > time() + 30) {
            return $session['access_token'];
        }

        $response = $this->auth()->post('/token?grant_type=refresh_token', [
            'refresh_token' => $session['refresh_token'],
        ]);

        if ($response->failed()) {
            session()->forget(self::SESSION_KEY);

            return null;
        }

        return $this->startSession($response);
    }

    // --- data -------------------------------------------------------------

    /** PostgREST as the signed-in user, e.g. rest()->get('/docs', [...]). */
    public function rest(): PendingRequest
    {
        return $this->asUser()->baseUrl($this->url().'/rest/v1');
    }

    /** Call /functions/v1/{name} as the signed-in user. */
    public function function(string $name, string $method = 'GET', array $body = []): Response
    {
        return $this->asUser()->send($method, $this->url().'/functions/v1/'.$name, $body ? ['json' => $body] : []);
    }

    // --- internals --------------------------------------------------------

    private function auth(): PendingRequest
    {
        return Http::baseUrl($this->url().'/auth/v1')
            ->withHeaders(['apikey' => $this->anonKey()])
            ->acceptJson();
    }

    private function asUser(): PendingRequest
    {
        return Http::withHeaders(['apikey' => $this->anonKey()])
            ->withToken($this->accessToken() ?? $this->anonKey())
            ->acceptJson();
    }

    private function startSession(Response $response): string
    {
        if ($response->failed()) {
            throw new RuntimeException(
                $response->json('msg') ?? $response->json('error_description') ?? $response->json('message') ?? 'Request failed'
            );
        }

        if (! $response->json('access_token')) {
            throw new RuntimeException('Check your email to confirm your account, then sign in.');
        }

        session()->put(self::SESSION_KEY, [
            'access_token' => $response->json('access_token'),
            'refresh_token' => $response->json('refresh_token'),
            'expires_at' => $response->json('expires_at') ?? time() + $response->json('expires_in', 3600),
            'email' => $response->json('user.email'),
            'user_id' => $response->json('user.id'),
        ]);

        return $response->json('access_token');
    }
}
