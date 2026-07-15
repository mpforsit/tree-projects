-- M9 / 0025 — race-safe per-email OTP throttle (§8.1).
-- The request-otp route counted then inserted in two statements; N
-- parallel requests could all read a count below the limit before any of
-- them logged (found by the M9 burst test). This function serializes
-- concurrent checks per email with a transaction-scoped advisory lock and
-- makes count+log one atomic call.

CREATE FUNCTION auth_otp_throttle(p_email citext) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('auth_otp:' || lower(p_email::text)));
  SELECT count(*) INTO v_count
  FROM event
  WHERE type = 'auth.otp_requested'
    AND payload ->> 'email' = lower(p_email::text)
    AND created_at > now() - interval '1 hour';
  IF v_count >= 5 THEN
    RETURN false;
  END IF;
  INSERT INTO event (tenant_id, node_id, actor_member_id, source, type, payload)
  VALUES (NULL, NULL, NULL, 'ui', 'auth.otp_requested',
          jsonb_build_object('email', lower(p_email::text)));
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION auth_otp_throttle(citext) TO auth_user;
