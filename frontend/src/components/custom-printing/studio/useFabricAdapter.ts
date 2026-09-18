import { useEffect, useRef, useState } from 'react';
import { fabric } from 'fabric';
import { useCustomDesignStore } from '@/store/useCustomDesignStore';

export const useFabricAdapter = (canvasId: string, width: number, height: number) => {
  const [canvas, setCanvas] = useState<fabric.Canvas | null>(null);
  const isSyncing = useRef(false);
  const { design, activeZone, updateElement, selectElement, pushHistory } = useCustomDesignStore();
  const elements = design[activeZone]?.elements || [];

  // Initialize Canvas
  useEffect(() => {
    const newCanvas = new fabric.Canvas(canvasId, {
      width,
      height,
      preserveObjectStacking: true,
      selection: true,
    });
    setCanvas(newCanvas);

    return () => {
      newCanvas.dispose();
    };
  }, [canvasId, width, height]);

  // Sync From Store to Fabric (Render pass)
  useEffect(() => {
    if (!canvas) return;
    if (isSyncing.current) return; // Prevent recursive update loop from Fabric events

    canvas.clear();

    // Render Safe Printable Zone
    const printableZone = new fabric.Rect({
      left: 50,
      top: 100,
      width: width - 100,
      height: height - 200,
      fill: 'transparent',
      stroke: 'rgba(0,0,0,0.2)',
      strokeWidth: 2,
      strokeDashArray: [5, 5],
      selectable: false,
      evented: false,
      id: 'printable-zone-border',
    } as any);
    canvas.add(printableZone);

    const sortedElements = [...elements].sort((a, b) => (a.zIndex || 1) - (b.zIndex || 1));

    sortedElements.forEach((el) => {
      let obj: fabric.Object | null = null;
      
      if (el.type === 'TEXT') {
        obj = new fabric.IText(el.properties.text || 'Add Text', {
          id: el.id,
          left: el.x,
          top: el.y,
          width: el.width,
          angle: el.rotation,
          scaleX: el.scaleX,
          scaleY: el.scaleY,
          opacity: el.opacity,
          lockMovementX: el.locked,
          lockMovementY: el.locked,
          fontFamily: el.properties.fontFamily || 'sans-serif',
          fontSize: el.properties.fontSize || 32,
          fill: el.properties.fill || '#000000',
          textAlign: el.properties.textAlign || 'center',
        } as any);
        canvas.add(obj);
      } else if (el.type === 'IMAGE' && el.properties.src) {
        fabric.Image.fromURL(el.properties.src, (img) => {
          img.set({
            id: el.id,
            left: el.x,
            top: el.y,
            angle: el.rotation,
            scaleX: el.scaleX,
            scaleY: el.scaleY,
            opacity: el.opacity,
            lockMovementX: el.locked,
            lockMovementY: el.locked,
          } as any);
          canvas.add(img);
          canvas.renderAll();
        }, { crossOrigin: 'anonymous' });
      }
    });

    canvas.renderAll();
  }, [canvas, elements, width, height]);

  // Sync From Fabric to Store (Event pass)
  useEffect(() => {
    if (!canvas) return;

    const handleModify = (e: fabric.IEvent) => {
      if (!e.target) return;
      const obj = e.target as any;
      if (!obj.id || obj.id === 'printable-zone-border') return;

      isSyncing.current = true;
      
      const updates: any = {
        x: obj.left,
        y: obj.top,
        rotation: obj.angle || 0,
        scaleX: obj.scaleX || 1,
        scaleY: obj.scaleY || 1,
        opacity: obj.opacity || 1,
      };

      if (obj.type === 'i-text') {
        updates.properties = {
          ...elements.find(el => el.id === obj.id)?.properties,
          text: obj.text,
        };
      }

      updateElement(obj.id, updates);
      
      // Allow React to process, then release lock
      setTimeout(() => { isSyncing.current = false; }, 0);
    };

    const handleModifyEnd = (e: fabric.IEvent) => {
      if (e.target && (e.target as any).id !== 'printable-zone-border') {
        pushHistory();
      }
    };

    const handleMoving = (e: fabric.IEvent) => {
      const obj = e.target;
      if (!obj || (obj as any).id === 'printable-zone-border') return;
      
      const bounds = { left: 50, top: 100, right: width - 50, bottom: height - 100 };
      
      // Calculate actual dimensions taking scale into account
      // Note: for rotated objects this simple bounding box logic might clip early, 
      // but it serves as a basic printable safe zone.
      const objWidth = obj.getScaledWidth();
      const objHeight = obj.getScaledHeight();

      if (obj.left! < bounds.left) obj.left = bounds.left;
      if (obj.top! < bounds.top) obj.top = bounds.top;
      if (obj.left! + objWidth > bounds.right) obj.left = bounds.right - objWidth;
      if (obj.top! + objHeight > bounds.bottom) obj.top = bounds.bottom - objHeight;
    };

    const handleSelection = (e: fabric.IEvent) => {
      const selected = e.selected?.[0] as any;
      if (selected && selected.id && selected.id !== 'printable-zone-border') {
        selectElement(selected.id);
      } else {
        selectElement(null);
      }
    };

    canvas.on('object:modified', handleModify);
    canvas.on('object:modified', handleModifyEnd);
    canvas.on('object:moving', handleMoving);
    canvas.on('selection:created', handleSelection);
    canvas.on('selection:updated', handleSelection);
    canvas.on('selection:cleared', handleSelection);
    canvas.on('text:changed', handleModify); // live text editing

    return () => {
      canvas.off('object:modified');
      canvas.off('object:moving');
      canvas.off('selection:created');
      canvas.off('selection:updated');
      canvas.off('selection:cleared');
      canvas.off('text:changed');
    };
  }, [canvas, updateElement, selectElement, pushHistory, elements]);

  return { canvas };
};
