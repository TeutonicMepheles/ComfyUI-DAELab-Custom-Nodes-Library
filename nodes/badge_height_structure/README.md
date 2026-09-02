# Badge Height Structure

`DAELAB.BadgeStructureConstraintV1` validates the single global GPT-Image-2
height-establishment result used by Badge Workflow 8.5. It is deliberately
separate from all material-region configuration and generation nodes.

The node accepts the GPT candidate, the existing deterministic height base, the
flat artwork, aligned discrete height map, and exact foreground mask. It:

- validates tensor shape, batch, finite values, and legal height levels;
- removes source or hallucinated color from the GPT geometry proof;
- reapplies only the accepted light/shadow ratio to the immutable flat artwork,
  so unedited transparent-lacquer regions keep their original colors;
- protects the silhouette, artwork boundaries, and height-transition pixels;
- guarantees that pixels outside the foreground and inside the protected band
  come from the deterministic fallback;
- rejects candidates without enough relief or height-boundary signal;
- returns the deterministic colored height base for invalid candidates.

The GPT node remains a directly visible native `OpenAIGPTImageNodeV2` in the
workflow. This module does not call the API and does not contain material logic.
