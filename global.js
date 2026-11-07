import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm";

// Detect local server vs GitHub Pages
const BASE_PATH =
  location.hostname === "localhost" || location.hostname === "127.0.0.1"
    ? "/" // Local server
    : "/EV-Market-Research/"; // GitHub Pages repo name

d3.csv(BASE_PATH + "data/cleaned_ev_data.csv", (d) => ({
  brand: d.brand,
  tier: d.market_segment,
  model: d.model,
  year: +d.year,
  price: +d.price_usd,
})).then((data) => {
  const margin = { top: 20, right: 30, bottom: 40, left: 70 };
  const svgWidth = 700;
  const svgHeight = 400;
  const width = svgWidth - margin.left - margin.right;
  const height = svgHeight - margin.top - margin.bottom;

  const svg = d3
    .select("#line-chart")
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  // Domains come from ALL data so the axes stay fixed while filtering
  const [dataMin, dataMax] = d3.extent(data, (d) => d.year);
  const x = d3
    .scaleLinear()
    .domain([dataMin - 0.5, dataMax + 0.5]) // half a year of padding each side
    .range([0, width]);

  const minPrice = d3.min(data, (d) => d.price);
  const maxPrice = d3.max(data, (d) => d.price);

  const y = d3
    .scaleLinear()
    .domain([minPrice * 0.95, maxPrice * 1.05])
    .nice()
    .range([height, 0]);

  svg
    .append("defs")
    .append("clipPath")
    .attr("id", "chart-clip")
    .append("rect")
    .attr("width", width)
    .attr("height", height);

  svg
    .append("g")
    .attr("transform", `translate(0,${height})`)
    .call(
      d3
        .axisBottom(x)
        .tickValues(d3.range(dataMin, dataMax + 1)) // whole years only
        .tickFormat(d3.format("d")),
    );
  svg.append("g").call(d3.axisLeft(y).tickFormat(d3.format("$,")));

  const linesLayer = svg.append("g");
  // Empty-state message (hidden until there's no data)
  const emptyMsg = svg
    .append("text")
    .attr("class", "empty-msg")
    .attr("x", width / 2)
    .attr("y", height / 2)
    .attr("text-anchor", "middle")
    .text("No data for this selection")
    .style("opacity", 0);
  const line = d3
    .line()
    .x((d) => x(d.year))
    .y((d) => y(d.avgPrice));

  const color = d3.scaleOrdinal(d3.schemeTableau10);

  // ---------- Multi-select checkbox dropdowns ----------
  function buildMultiSelect(menuId, label, values) {
    const menu = d3.select(menuId);
    const summary = menu.select("summary");

    const rows = menu
      .select(".options")
      .selectAll("label")
      .data(values)
      .join("label");

    rows
      .append("input")
      .attr("type", "checkbox")
      .attr("value", (d) => d)
      .on("change", () => {
        updateSummary();
        update();
      });
    rows.append("span").text((d) => d);

    // Clear button
    menu
      .select(".options")
      .append("button")
      .attr("type", "button")
      .attr("class", "clear-btn")
      .text("Clear")
      .on("click", () => {
        menu.selectAll("input").property("checked", false);
        updateSummary();
        update();
      });

    function updateSummary() {
      const sel = getSelected(menuId);
      const text =
        sel.length === 0
          ? "All"
          : sel.length <= 2
            ? sel.join(", ")
            : `${sel.length} selected`;
      summary.text(`${label}: ${text}`);
    }
  }

  function getSelected(menuId) {
    return d3
      .selectAll(`${menuId} input:checked`)
      .nodes()
      .map((n) => n.value);
  }

  // Custom order for market segments, high to low
  const tierOrder = ["luxury", "premium", "mid-range", "budget"];

  const tierRank = (t) => {
    const i = tierOrder.indexOf(t.toLowerCase());
    return i === -1 ? tierOrder.length : i; // unknown values go last
  };

  const tierValues = [...new Set(data.map((d) => d.tier))].sort(
    (a, b) => tierRank(a) - tierRank(b) || d3.ascending(a, b),
  );

  buildMultiSelect(
    "#brand-menu",
    "Brand",
    [...new Set(data.map((d) => d.brand))].sort(),
  );
  buildMultiSelect("#tier-menu", "Tier", tierValues);

  // Close an open dropdown when clicking outside it
  document.addEventListener("click", (e) => {
    document.querySelectorAll("details.multi[open]").forEach((el) => {
      if (!el.contains(e.target)) el.removeAttribute("open");
    });
  });

  // ---------- Update chart ----------

  function update() {
    const brands = getSelected("#brand-menu");
    const tiers = getSelected("#tier-menu");

    // Empty selection = no filter on that attribute
    const filtered = data.filter(
      (d) =>
        (brands.length === 0 || brands.includes(d.brand)) &&
        (tiers.length === 0 || tiers.includes(d.tier)),
    );

    // One line per brand/tier combination (only split on filters in use)
    const keyOf = (d) =>
      [brands.length ? d.brand : null, tiers.length ? d.tier : null]
        .filter(Boolean)
        .join(" · ") || "All EVs";

    const series = d3
      .rollups(
        filtered,
        (rows) =>
          Array.from(
            d3.rollup(
              rows,
              (v) => d3.mean(v, (d) => d.price),
              (d) => d.year,
            ),
            ([year, avgPrice]) => ({ year, avgPrice }),
          ).sort((a, b) => a.year - b.year),
        keyOf,
      )
      .sort((a, b) => {
        const pa = a[0].split(" · "),
          pb = b[0].split(" · ");
        if (tiers.length) {
          // Group by brand (if used), then order tiers low to high
          const brandCmp = brands.length ? d3.ascending(pa[0], pb[0]) : 0;
          return (
            brandCmp ||
            tierRank(pa[pa.length - 1]) - tierRank(pb[pb.length - 1])
          );
        }
        return d3.ascending(a[0], b[0]);
      });

    // Show the message only when no lines will be drawn
    emptyMsg
      .transition()
      .duration(300)
      .style("opacity", series.length === 0 ? 1 : 0);

    linesLayer
      .selectAll("path.series")
      .data(series, (d) => d[0])
      .join(
        (enter) =>
          enter
            .append("path")
            .attr("class", "series")
            .attr("fill", "none")
            .attr("stroke-width", 2)
            .attr("stroke", (d) => color(d[0]))
            .attr("d", (d) => line(d[1]))
            .attr("opacity", 0)
            .call((e) => e.transition().duration(500).attr("opacity", 1)),
        (update) =>
          update.call((u) =>
            u
              .transition()
              .duration(500)
              .attr("d", (d) => line(d[1])),
          ),
        (exit) =>
          exit.call((e) =>
            e.transition().duration(300).attr("opacity", 0).remove(),
          ),
      );

    // Legend
    // Legend
    const items = d3
      .select("#legend")
      .selectAll(".legend-item")
      .data(series, (d) => d[0])
      .join((enter) => {
        const item = enter.append("span").attr("class", "legend-item");

        item.append("span").attr("class", "swatch");

        item.append("span").attr("class", "label");

        return item;
      });

    items.select(".swatch").style("background", (d) => color(d[0]));

    items.select(".label").text((d) => d[0]);

    items.style("cursor", "pointer").on("click", function (event, d) {
      const item = d3.select(this);
      const hidden = !item.classed("is-hidden");

      item.classed("is-hidden", hidden).style("opacity", hidden ? 0.35 : 1);

      linesLayer
        .selectAll("path.series")
        .filter((series) => series[0] === d[0])
        .style("display", hidden ? "none" : null);
    });
  }

  update(); // initial draw
});
