"use client";

import React, { useState } from 'react';
import { Loader2, Sparkles, Image as ImageIcon } from 'lucide-react';
import { api } from '@/lib/api';
import { useCustomDesignStore } from '@/store/useCustomDesignStore';

export const AIPanel = () => {
  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState('Photorealistic');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  
  const { addElement } = useCustomDesignStore();

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;

    setIsGenerating(true);
    setGeneratedImage(null);
    try {
      const res = await api.post('/ai/generate', {
        prompt,
        style
      });
      if (res.data.success) {
        setGeneratedImage(res.data.data.imageUrl);
      }
    } catch (error: any) {
      alert(error.response?.data?.message || "Failed to generate image.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAddToCanvas = () => {
    if (!generatedImage) return;

    addElement({
      id: crypto.randomUUID(),
      type: 'IMAGE',
      x: 100,
      y: 100,
      width: 200,
      height: 200,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
      locked: false,
      zIndex: 1,
      properties: {
        src: generatedImage
      }
    });

    // Reset after adding
    setGeneratedImage(null);
    setPrompt('');
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto hide-scrollbar p-4">
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="text-purple-500" size={18} />
        <h3 className="font-semibold text-gray-800 text-sm">Design with AI</h3>
      </div>
      
      <form onSubmit={handleGenerate} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Describe your design</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="w-full text-sm p-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 bg-gray-50 focus:bg-white transition-colors"
            rows={3}
            placeholder="E.g., A cyberpunk cat playing a neon guitar..."
            required
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Style</label>
          <select
            value={style}
            onChange={(e) => setStyle(e.target.value)}
            className="w-full text-sm p-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white"
          >
            <option value="Photorealistic">Photorealistic</option>
            <option value="Anime">Anime</option>
            <option value="Cyberpunk">Cyberpunk</option>
            <option value="Vintage Logo">Vintage Logo</option>
            <option value="Minimalist">Minimalist</option>
            <option value="Watercolor">Watercolor</option>
          </select>
        </div>

        <button
          type="submit"
          disabled={isGenerating || !prompt.trim()}
          className="w-full py-2.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-purple-300 disabled:cursor-not-allowed transition-colors text-sm font-bold flex items-center justify-center gap-2"
        >
          {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
          {isGenerating ? 'Generating...' : 'Generate Image'}
        </button>
      </form>

      {generatedImage && (
        <div className="mt-6 border-t pt-4">
          <h4 className="text-xs font-bold text-gray-500 mb-2 uppercase tracking-wider">Result</h4>
          <div className="rounded-lg overflow-hidden border border-gray-200 bg-gray-50 mb-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={generatedImage} alt="AI Generated" className="w-full h-auto" />
          </div>
          <button
            onClick={handleAddToCanvas}
            className="w-full py-2 bg-black text-white rounded-lg hover:bg-gray-800 transition-colors text-sm font-bold flex items-center justify-center gap-2"
          >
            <ImageIcon size={16} />
            Add to Canvas
          </button>
        </div>
      )}
    </div>
  );
};
