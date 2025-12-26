'use client';
import { useEffect, useMemo, useRef } from 'react';
import embed, { VisualizationSpec, EmbedOptions } from 'vega-embed';

type Props = {
  data: any[];                       // your rows from /api/run-sql
  spec: VisualizationSpec;           // Vega-Lite spec (AI or user-built)
  opts?: EmbedOptions;
};

export default function VegaLite({ data, spec, opts }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const specWithData = useMemo<VisualizationSpec>(() => ({
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
    data: { name: 'table' },
    autosize: { type: 'fit', contains: 'padding' },
    ...spec
  }), [spec]);

  useEffect(() => {
    if (!ref.current) return;
    const view = embed(ref.current, specWithData, {
      actions: false,
      renderer: 'canvas',
      ...opts,
      // Replace any inline data; we inject named dataset
      loader: { target: 'container' } as any
    }).then(res => {
      res.view.change(
        'table',
        vega.changeset().remove(() => true).insert(data)
      ).run();
      return res;
    });

    return () => { view.then(v => v.view.finalize()).catch(() => {}); };
  }, [data, specWithData, opts]);

  return <div style={{ width: '100%', minHeight: 240 }} ref={ref} />;
}
