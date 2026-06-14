import { Editor } from "./Editor";

export default async function AdminEdit({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <Editor slug={slug} />;
}
