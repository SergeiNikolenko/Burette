import { useMemo, type ComponentProps } from "react";
import GridMolecule3D from "./grid-molecule-3d";
import { useObjectUrl } from "./file-thumbnail/renderers/use-object-url";
import { effectKey } from "../lib/effect-key";

type PreviewProps = Omit<ComponentProps<typeof GridMolecule3D>, "molblock" | "dataURL">;

function BlobPreview({ blob, ...props }: PreviewProps & { blob: Blob }) {
  const dataURL = useObjectUrl(blob);
  return dataURL ? <GridMolecule3D {...props} molblock="" dataURL={dataURL} /> : null;
}

export function MoleculeFilePreview({ data, ...props }: PreviewProps & { data: string }) {
  const blob = useMemo(() => new Blob([data], { type: "chemical/x-mdl-molfile" }), [data]);
  // A new payload unmounts the previous iframe and its URL owner together.
  return <BlobPreview key={effectKey(blob)} blob={blob} {...props} />;
}
