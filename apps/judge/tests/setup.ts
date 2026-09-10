// Tests run only against local fakes and never connect a production Judge.
process.env.ALLOW_UNAUTHENTICATED_JUDGE = 'true'
process.env.SERVER_URL ||= 'http://127.0.0.1:3002'
