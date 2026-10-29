-- messages may only be written/read inside a conversation the user owns
drop policy if exists "own messages" on public.messages;
create policy "own messages" on public.messages
  for all using (
    auth.uid() = user_id
    and exists (select 1 from public.conversations c where c.id = conversation_id and c.user_id = auth.uid())
  ) with check (
    auth.uid() = user_id
    and exists (select 1 from public.conversations c where c.id = conversation_id and c.user_id = auth.uid())
  );
