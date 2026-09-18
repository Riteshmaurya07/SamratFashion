"use client";

import React, { useEffect } from 'react';
import { GarmentMockup } from './GarmentMockup';
import { CanvasEditor } from './CanvasEditor';
import { Toolbars } from './LeftSidebar/Toolbars';
import { PropertiesPanel } from './RightSidebar/PropertiesPanel';
import { SizeMatrix } from './RightSidebar/SizeMatrix';
import { TemplatesPanel } from './LeftSidebar/TemplatesPanel';
import { AIPanel } from './LeftSidebar/AIPanel';
import { Save, Loader2, Check, LayoutTemplate, Sparkles } from 'lucide-react';
import { useCustomDesignStore, DesignZone } from '@/store/useCustomDesignStore';

export const DesignStudio = ({ productId, variantId, initialColor }: { productId: string, variantId: string, initialColor?: string }) => {
  const { activeZone, setActiveZone, saveDesign, saveStatus } = useCustomDesignStore();
  const [leftTab, setLeftTab] = React.useState<'templates' | 'ai'>('templates');

  const zones: { id: DesignZone; label: string }[] = [
    { id: 'front', label: 'Front' },
    { id: 'back', label: 'Back' },
    { id: 'leftSleeve', label: 'Left Sleeve' },
    { id: 'rightSleeve', label: 'Right Sleeve' },
  ];

  // In a real implementation we would load the product details and variants on mount
  useEffect(() => {
    const { setBaseProduct } = useCustomDesignStore.getState();
    if (setBaseProduct) {
      setBaseProduct(productId, variantId, initialColor || '#ffffff');
    }
  }, [productId, variantId, initialColor]);

  return (
    <div className="flex flex-col lg:flex-row w-full h-[800px] lg:h-[800px] bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-2xl">
      {/* Left Sidebar / Top Toolbar on Mobile */}
      <div className="flex flex-col lg:flex-row lg:h-full lg:w-80 w-full h-auto border-b lg:border-b-0 lg:border-r border-gray-200 bg-white z-20 shadow-[4px_0_15px_rgba(0,0,0,0.03)]">
        <Toolbars />
        <div className="hidden lg:flex flex-col flex-1 border-l border-gray-100 overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-gray-100 h-16 shrink-0">
            <button 
              onClick={() => setLeftTab('templates')}
              className={`flex-1 flex items-center justify-center gap-2 text-sm font-medium border-b-2 transition-colors ${leftTab === 'templates' ? 'border-black text-black' : 'border-transparent text-gray-500 hover:text-gray-900 hover:bg-gray-50'}`}
            >
              <LayoutTemplate size={16} /> Templates
            </button>
            <button 
              onClick={() => setLeftTab('ai')}
              className={`flex-1 flex items-center justify-center gap-2 text-sm font-medium border-b-2 transition-colors ${leftTab === 'ai' ? 'border-purple-600 text-purple-600' : 'border-transparent text-gray-500 hover:text-gray-900 hover:bg-gray-50'}`}
            >
              <Sparkles size={16} /> AI Design
            </button>
          </div>
          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            {leftTab === 'templates' && <TemplatesPanel />}
            {leftTab === 'ai' && <AIPanel />}
          </div>
        </div>
      </div>

      {/* Main Canvas Area */}
      <div className="flex-1 flex flex-col bg-gray-50/50">
        
        {/* Zone Selector & Save Header */}
        <div className="h-16 border-b border-gray-200 flex items-center justify-between px-6 bg-white z-10">
          <div className="flex space-x-2">
            {zones.map((zone) => (
              <button
                key={zone.id}
                onClick={() => setActiveZone(zone.id)}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                  activeZone === zone.id 
                    ? 'bg-black text-white shadow-md scale-105' 
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {zone.label}
              </button>
            ))}
          </div>

          <button
            onClick={saveDesign}
            disabled={saveStatus === 'saving'}
            className="flex items-center space-x-2 px-4 py-2 bg-black text-white rounded-lg hover:bg-gray-800 disabled:bg-gray-400 transition-colors"
          >
            {saveStatus === 'saving' && <Loader2 size={16} className="animate-spin" />}
            {saveStatus === 'saved' && <Check size={16} className="text-green-400" />}
            {saveStatus === 'idle' && <Save size={16} />}
            <span className="text-sm font-medium">{saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved' : 'Save Design'}</span>
          </button>
        </div>

        {/* Editor Workspace */}
        <div className="flex-1 p-8 flex items-center justify-center overflow-auto">
          <div className="w-full max-w-2xl h-full flex items-center justify-center">
            <GarmentMockup>
              <CanvasEditor />
            </GarmentMockup>
          </div>
        </div>

      </div>

      {/* Right Sidebar */}
      <div className="w-full lg:w-80 bg-white border-t lg:border-t-0 lg:border-l border-gray-200 flex flex-col z-20 shadow-[-4px_0_15px_rgba(0,0,0,0.03)] overflow-y-auto">
        <div className="flex-1">
          <PropertiesPanel />
        </div>
        
        <SizeMatrix />
      </div>
    </div>
  );
};
