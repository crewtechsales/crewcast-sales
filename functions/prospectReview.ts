// Redirect to the live daily prospects review page
Deno.serve((_req) => {
  return new Response(null, {
    status: 302,
    headers: { 'Location': 'https://base44.app/api/apps/6a274334d6b0962f39294123/functions/dailyProspects' },
  });
});
