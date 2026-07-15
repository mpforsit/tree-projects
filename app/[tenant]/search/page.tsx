import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { SearchResults, type SearchResultRow } from "@/components/search-results";
import { getSessionUser } from "@/lib/auth";
import { withTenantContext } from "@/lib/db";
import { strings } from "@/lib/strings";
import { userTenants } from "@/lib/tenants";
import { branchPathLabel, fetchVisibleNodes } from "@/lib/tree";

interface SearchHit {
  kind: string;
  node_id: string;
  title: string;
  path: string;
  snippet: string | null;
}

/** Search results screen (spec §15.1): built plainly from tokens, rows
 *  grouped by result type, branch path as second line. Scoping is
 *  structural: search_visible runs as app_user under RLS. */
export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { tenant: slug } = await params;
  const { q } = await searchParams;
  const user = await getSessionUser(await headers());
  if (!user) redirect("/login");
  const tenant = (await userTenants(user.id)).find((t) => t.slug === slug);
  if (!tenant) notFound();

  const query = (q ?? "").trim();
  const data = query
    ? await withTenantContext({ userId: user.id, tenantId: tenant.id }, async (client) => {
        const { rows } = await client.query<SearchHit>(
          `SELECT kind, node_id, title, path::text AS path, snippet
           FROM search_visible($1) ORDER BY rank DESC`,
          [query],
        );
        const nodes = await fetchVisibleNodes(client);
        return { rows, nodes };
      })
    : { rows: [], nodes: [] };

  const results: SearchResultRow[] = data.rows.map((r) => ({
    kind: r.kind,
    nodeId: r.node_id,
    title: r.title,
    pathLabel: branchPathLabel(data.nodes, r.path),
    snippet: r.snippet,
  }));

  return (
    <div className="view-fade">
      <h1 style={{ fontSize: 22, margin: "0 0 18px" }}>
        {query ? strings.search.resultsFor(query) : strings.search.title}
      </h1>
      <SearchResults slug={slug} results={results} />
    </div>
  );
}
