-- Supabase's security advisor flags every function whose search_path can be
-- changed by the caller. private.shared_window only returns a constant, so
-- this changes nothing it does; it brings it in line with every other
-- function here, which all pin search_path to ''.
alter function private.shared_window() set search_path = '';
