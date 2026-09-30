# Badge Height Structure

The Badge Workflow 8.5 height branch is deliberately separate from all
material-region configuration and generation nodes. It contains three stable
DAELab nodes:

- `DAELAB.BadgeReliefGeometryV1` turns the legal six-level height map into a
  colored deterministic relief with finite-width bevels, normals, specular
  lift, and contact ambient occlusion.
- `DAELAB.BadgeGPTStructureTransferV1` resizes and registers the GPT grayscale
  proof, then adds only bounded form/detail frequencies in OKLab lightness.
- `DAELAB.BadgeStructureConstraintV1` remains available for older 8.5 workflow
  revisions and now safely resizes non-standard GPT output before validation.

The structure nodes accept the GPT candidate, deterministic relief base, flat
artwork, aligned discrete height map, and exact foreground mask. Together they:

- validates tensor shape, batch, finite values, and legal height levels;
- accepts a non-1024 GPT proof through explicit bicubic normalization while the
  flat artwork, masks, and discrete height authority remain strictly 1024;
- removes source or hallucinated color from the GPT geometry proof;
- reapplies only the accepted light/shadow ratio to the immutable flat artwork,
  so unedited transparent-lacquer regions keep their original colors;
- preserve silhouette coordinates and replace the locked boundary band with
  deterministic bevel geometry rather than flattening it;
- guarantee that pixels outside the foreground and inside the locked band come
  from the deterministic relief base;
- rejects candidates without enough relief or height-boundary signal;
- returns the deterministic colored height base for invalid candidates.

The GPT node remains a directly visible native `OpenAIGPTImageNodeV2` in the
workflow. This module does not call the API and does not contain material logic.
