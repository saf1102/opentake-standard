/** Native OpenScreen zooms the screen rectangle in canvas coordinates.
 * Roundness is output-pixel based, not CSS pixels or a fixed preview mask. */
export function screenPreviewRect(rect:{x:number;y:number;width:number;height:number},canvas:{width:number;height:number},zoom:{scale:number;translateXPercent:number;translateYPercent:number}) {
 return {x:rect.x*zoom.scale+canvas.width*zoom.translateXPercent/100,y:rect.y*zoom.scale+canvas.height*zoom.translateYPercent/100,width:rect.width*zoom.scale,height:rect.height*zoom.scale};
}
export function previewRadius(radius:number,canvas:{width:number;height:number},output:{width:number;height:number}) {
 return radius*Math.min(canvas.width,canvas.height)/Math.max(1,Math.min(output.width,output.height));
}
