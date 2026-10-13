@extends('layout')
@section('title', $doc['title'] ?? 'Not found')
@section('content')
  <p><a href="/">&larr; All docs</a> · Laravel + cheapabase</p>
  <p id="me-email" class="muted">{{ $user['email'] }}</p>
  @if (! $doc)
    <p id="not-found">This doc doesn't exist, or you don't have access to it.</p>
  @else
    <h1 id="doc-title">{{ $doc['title'] }}</h1>
    <div id="presence" aria-label="People viewing this document"></div>
    <p id="typing" class="muted" role="status"></p>
    <form id="editor" method="POST" action="{{ route('docs.update', $doc['id']) }}">
      @csrf
      @method('PATCH')
      <label for="title">Title</label>
      <input id="title" name="title" value="{{ $doc['title'] }}" maxlength="500" required>
      <label for="content">Document</label>
      <textarea id="content" name="content">{{ $doc['content'] }}</textarea>
      <button id="save" type="submit">Save</button>
      <span id="status" class="muted" role="status">{{ session('status', 'Saved') }}</span>
    </form>
    <p class="muted">Autosaves as you type. Take turns editing; simultaneous changes use last-write-wins.</p>
    @if ($doc['owner_id'] === $user['id'])
      <form id="share-form">
        <label for="share-email">Share with an existing account</label>
        <input id="share-email" type="email" placeholder="alice@example.com" required>
        <button id="share" type="submit">Share</button>
      </form>
      <button id="delete" class="secondary" type="button">Delete document</button>
    @endif
    <p id="members" class="muted">@if (count($members))Shared with {{ implode(', ', array_column($members, 'email')) }}@endif</p>
    <p id="realtime-status" class="muted" role="status"></p>
    <p id="action-error" class="error" role="alert"></p>
    <script type="application/json" id="collaboration-config">{!! json_encode(['url' => $cheapabaseUrl, 'user' => $user, 'doc' => $doc, 'members' => $members], JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) !!}</script>
    <script type="module" src="/collaboration.js"></script>
  @endif
@endsection
