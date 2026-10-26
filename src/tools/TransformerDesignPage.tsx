import { TransformerDesignTool } from './transformer-design';
import { transformerDesignApi, saveTransformerExport } from '../services/transformerDesignApi';
import { getCoreOptions, getCoreOption, createCoreSnapshot } from '../features/core-library';
import { registerFlush } from '../services/saveRegistry';
import { useData } from '../state/DataContext';
export function TransformerDesignPage({ selectedId }: { selectedId?: string }) {
 const { repo } = useData();
 return <TransformerDesignTool key={repo.path} memoryScope={repo.path ?? undefined} api={transformerDesignApi} coreApi={{getCoreOptions,getCoreOption,createCoreSnapshot}} selectedId={selectedId} registerFlush={registerFlush} pdfOptions={{onSave:saveTransformerExport}} />;
}
