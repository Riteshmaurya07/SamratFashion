"use client";

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import Image from 'next/image';
import { useCustomDesignStore, IDesignLayout } from '@/store/useCustomDesignStore';

interface ITemplate {
  _id: string;
  name: string;
  category: string;
  thumbnailUrl: string;
  design: IDesignLayout;
}

export const TemplatesPanel = () => {
  const [templates, setTemplates] = useState<ITemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const { loadDesign } = useCustomDesignStore();

  useEffect(() => {
    const fetchTemplates = async () => {
      try {
        const response = await fetch('/api/custom-templates');
        const data = await response.json();
        if (data.success) {
          setTemplates(data.data);
        } else {
          setError('Failed to load templates');
        }
      } catch (err) {
        setError('An error occurred');
      } finally {
        setIsLoading(false);
      }
    };
    fetchTemplates();
  }, []);

  const handleApplyTemplate = (template: ITemplate) => {
    if (confirm("Applying a template will replace your current design. Are you sure?")) {
      loadDesign(template.design, { 
        // We do not overwrite designId because we want this to still save as the current custom design, not the template's ID
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-40">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-sm text-red-500 text-center">
        {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto hide-scrollbar p-3">
      <h3 className="font-semibold text-gray-800 text-sm mb-3">Templates</h3>
      <div className="grid grid-cols-2 gap-3">
        {templates.map((tpl) => (
          <button 
            key={tpl._id} 
            className="flex flex-col items-start gap-1 group text-left"
            onClick={() => handleApplyTemplate(tpl)}
          >
            <div className="relative w-full aspect-[3/4] bg-gray-100 rounded-md overflow-hidden border border-gray-200 group-hover:border-black transition-colors">
              <Image 
                src={tpl.thumbnailUrl || 'https://via.placeholder.com/300x400?text=Template'} 
                alt={tpl.name}
                fill
                className="object-cover"
              />
            </div>
            <span className="text-xs font-medium text-gray-700 truncate w-full group-hover:text-black">
              {tpl.name}
            </span>
            <span className="text-[10px] text-gray-400 uppercase tracking-wide">
              {tpl.category}
            </span>
          </button>
        ))}
        {templates.length === 0 && (
          <div className="col-span-2 text-center text-sm text-gray-400 py-4">
            No templates available.
          </div>
        )}
      </div>
    </div>
  );
};
