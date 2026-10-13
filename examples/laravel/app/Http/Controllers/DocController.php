<?php

namespace App\Http\Controllers;

use App\Services\Cheapabase;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\View\View;

class DocController extends Controller
{
    public function __construct(private Cheapabase $cheapabase) {}

    /** Sign-in form when signed out, otherwise the hello message and the user's docs. */
    public function index(): View
    {
        if (! $user = $this->cheapabase->user()) {
            return view('signin');
        }

        return view('docs.index', [
            'user' => $user,
            'cheapabaseUrl' => $this->cheapabase->url(),
            'hello' => $this->cheapabase->function('hello')->json('message'),
            // RLS only returns docs this user owns or was shared.
            'docs' => $this->cheapabase->rest()
                ->get('/docs', ['select' => 'id,title,owner_id', 'order' => 'updated_at.desc'])
                ->throw()
                ->json(),
        ]);
    }

    public function store(Request $request): RedirectResponse
    {
        $doc = $this->cheapabase->rest()
            ->withHeaders(['Prefer' => 'return=representation'])
            ->post('/docs', ['title' => $request->input('title') ?: 'Untitled'])
            ->throw()
            ->json(0);

        return redirect()->route('docs.show', $doc['id']);
    }

    public function show(string $id): View
    {
        $response = $this->cheapabase->rest()->get('/docs', ['id' => "eq.$id", 'select' => '*']);

        // A malformed id is a 400 from PostgREST; a doc RLS hides is just an empty list.
        $doc = $response->successful() ? $response->json(0) : null;

        return view('docs.show', [
            'doc' => $doc,
            'cheapabaseUrl' => $this->cheapabase->url(),
            'user' => $this->cheapabase->user(),
            'members' => $doc ? $this->cheapabase->rest()->get('/doc_members', [
                'doc_id' => "eq.$id", 'select' => 'email',
            ])->throw()->json() : [],
        ]);
    }

    public function update(Request $request, string $id): RedirectResponse|JsonResponse
    {
        $patch = $request->validate([
            'content' => 'sometimes|nullable|string',
            'title' => 'sometimes|required|string|max:500',
        ]);
        if (array_key_exists('content', $patch)) {
            $patch['content'] = $patch['content'] ?? '';
        }
        $rows = $this->cheapabase->rest()->withHeaders(['Prefer' => 'return=representation'])
            ->patch("/docs?id=eq.$id", $patch)->throw()->json();
        abort_unless(count($rows), 404);

        if ($request->expectsJson()) {
            return response()->json($rows[0]);
        }

        return redirect()->route('docs.show', $id)->with('status', 'Saved');
    }

    public function list(): JsonResponse
    {
        return response()->json($this->cheapabase->rest()->get('/docs', [
            'select' => 'id,title,owner_id', 'order' => 'updated_at.desc',
        ])->throw()->json());
    }

    public function realtimeSession(): JsonResponse
    {
        // Refresh in PHP; only the short-lived access token reaches the browser.
        return response()->json(['accessToken' => $this->cheapabase->accessToken()])
            ->header('Cache-Control', 'no-store');
    }

    public function share(Request $request, string $id): JsonResponse
    {
        $data = $request->validate(['email' => 'required|email']);
        $response = $this->cheapabase->function('share-doc', 'POST', [
            'doc_id' => $id, 'email' => $data['email'],
        ]);

        return response()->json($response->json(), $response->status());
    }

    public function destroy(string $id): JsonResponse
    {
        // Postgres enforces owner-only deletion. Returning rows detects hidden/no-op deletes.
        $rows = $this->cheapabase->rest()->withHeaders(['Prefer' => 'return=representation'])
            ->delete("/docs?id=eq.$id")->throw()->json();
        abort_unless(count($rows), 404);

        return response()->json(['ok' => true]);
    }
}
