# Tessera: floor pattern planner

A dependency-free web app for planning a floor. You map out the room, give it your **tile size** or **wood board length × width**, and it lays out fashionable patterns, counts every full and cut piece, and estimates how much material to order.

Open `floorplan/index.html` in a browser. No build step or server is needed.

## Features

- **Room shapes:** rectangle, L-shape, or any custom polygon (list the corners in order). Metric or imperial units.
- **Materials:** tiles (with grout width) or wood boards (with joint gap), plus common size presets and finishes.
- **Patterns:** stack bond, checkerboard, running bond ½, third offset, random stagger (follows installer rules), diagonal grid, diagonal planks, herringbone, herringbone 90°, chevron and basketweave. The app only offers patterns that suit the piece's proportions.
- **Gallery:** every pattern drawn for *your* room, with its piece count, cuts and slivers.
- **Fine-tuning:** rotate or shift the pattern. **Minimise cuts** searches one repeat of the pattern for the layout with the fewest slivers and cuts.
- **Outputs:** quantity to order (boxes and cost are optional), a cut list grouped by size, info for each piece on hover, PNG export, a print view, and a shareable link (all settings are stored in the URL).

## How it works

- `js/geometry.js` has the polygon helpers: shoelace area, Sutherland–Hodgman clipping (a concave room clipped against convex pieces), inset for grout gaps, and a seeded PRNG.
- `js/patterns.js` holds the pattern definitions (as rows or lattices of motifs), the layout engine and the shift optimiser.
- `js/app.js` handles the UI: state, canvas rendering, the gallery, statistics and export.

## Tests

```
node floorplan/tests/geometry.test.js
```

The tests check that every pattern tiles a rectangular and an L-shaped room exactly (no gaps, no overlaps) at several rotations. They also check the grout coverage, the optimiser and the random-stagger joint rules.
