Deno.serve(async (req: Request) => {
  const fileUrl = "https://base44.app/api/apps/6a274334d6b0962f39294123/files/mp/public/6a274334d6b0962f39294123/1846217b7_crewcast_companies.html";
  const html = await fetch(fileUrl).then(r => r.text());
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
});
