"""
Asemic TouchDesigner Extension
Converts the web worker functionality to TouchDesigner .tox format
"""

from types import TouchDesignerOutput, TouchDesignerParams, TDComponent, TDOperator, TDParameter, TDTimer
from AsemicParser import AsemicParser, AsemicGroup, AsemicPt
from typing import Optional, Dict, Any, List
from types import ModuleType
import sys
import os

# Add the current directory to path for imports
current_dir = os.path.dirname(__file__)
if current_dir not in sys.path:
    sys.path.append(current_dir)


class AsemicExtension:
    """TouchDesigner Extension for Asemic Parser"""

    def __init__(self, ownerComp: TDComponent):
        self.ownerComp = ownerComp
        self.parser = AsemicParser()
        self.isRecording = False
        self.animationTimer: Optional[TDTimer] = None
        self.output = TouchDesignerOutput()
        self.params = TouchDesignerParams()

        # References to child operators
        self.sourceDAT: Optional[TDOperator] = None
        self.paramsDAT: Optional[TDOperator] = None
        self.geometryComp: Optional[TDOperator] = None
        self.audioOut: Optional[TDOperator] = None
        self.movieOut: Optional[TDOperator] = None
        self.errorDAT: Optional[TDOperator] = None

    def Initialize(self) -> None:
        """Initialize the extension"""
        print("Initializing Asemic Extension")
        self.setupComponents()
        self.setupParameters()

        # Initial setup if source exists
        if self.sourceDAT and hasattr(self.sourceDAT, 'text'):
            source = self.sourceDAT.text
            if source.strip():
                self.parser.setup(source)
                self.updateOutput()

    def setupComponents(self) -> None:
        """Setup child components"""
        try:
            self.sourceDAT = self.ownerComp.op('sourceDAT')
            self.paramsDAT = self.ownerComp.op('paramsDAT')
            self.geometryComp = self.ownerComp.op('geometryComp')
            self.audioOut = self.ownerComp.op('audioOut')
            self.movieOut = self.ownerComp.op('movieOut')
            self.errorDAT = self.ownerComp.op('errorDAT')
        except Exception as e:
            print(f"Warning: Some child components not found: {e}")

    def setupParameters(self) -> None:
        """Setup custom parameters"""
        # Add custom parameters if they don't exist
        try:
            page = (self.ownerComp.customPages[0] if self.ownerComp.customPages
                    else self.ownerComp.appendCustomPage('Asemic'))

            # Control parameters
            if not hasattr(self.ownerComp.par, 'play'):
                page.appendToggle('play', label='Play')[0].default = False

            if not hasattr(self.ownerComp.par, 'progress'):
                page.appendFloat('progress', label='Progress')[0].default = 0

            if not hasattr(self.ownerComp.par, 'record'):
                page.appendToggle('record', label='Record')[0].default = False

            # Resolution parameters
            if not hasattr(self.ownerComp.par, 'width'):
                page.appendInt('width', label='Width')[0].default = 1920
            if not hasattr(self.ownerComp.par, 'height'):
                page.appendInt('height', label='Height')[0].default = 1080

            # Animation parameters
            if not hasattr(self.ownerComp.par, 'fps'):
                page.appendFloat('fps', label='FPS')[0].default = 60.0
            if not hasattr(self.ownerComp.par, 'duration'):
                page.appendFloat('duration', label='Duration')[
                    0].default = 10.0

            # Action parameters
            if not hasattr(self.ownerComp.par, 'reset'):
                page.appendPulse('reset', label='Reset')
            if not hasattr(self.ownerComp.par, 'export'):
                page.appendPulse('export', label='Export')

        except Exception as e:
            print(f"Error setting up parameters: {e}")

    def onSourceChange(self, dat: TDOperator) -> None:
        """Called when source text changes"""
        if dat == self.sourceDAT and hasattr(dat, 'text'):
            source = dat.text
            if self.parser.rawSource != source:
                self.parser.setup(source)
                self.updateOutput()
                self.updateErrorOutput()

    def onParamChange(self, par: TDParameter) -> None:
        """Handle parameter changes"""
        try:
            if par.name == 'play':
                if par.eval():
                    self.startAnimation()
                else:
                    self.stopAnimation()
            elif par.name == 'record':
                if par.eval():
                    self.startRecording()
                else:
                    self.stopRecording()
            elif par.name == 'progress':
                self.parser.scrub(par.eval())
                self.updateOutput()
            elif par.name in ['width', 'height']:
                self.parser.preProcessing[par.name] = par.eval()
                # Update params object
                setattr(self.params, par.name, par.eval())
            elif par.name == 'reset':
                if par.eval():
                    self.resetParser()
            elif par.name == 'export':
                if par.eval():
                    self.exportTox()

            # Update parser params
            if hasattr(self.params, par.name):
                setattr(self.params, par.name, par.eval())
                self.parser.params[par.name] = par.eval()

        except Exception as e:
            print(f"Error handling parameter change: {e}")

    def startAnimation(self) -> None:
        """Start animation loop"""
        try:
            if self.animationTimer:
                self.animationTimer.destroy()

            # Use TouchDesigner's run function
            from types import run, op
            self.animationTimer = run(
                "args[0].animate()",
                self,
                delayFrames=1,
                delayRef=op('timer1') if op('timer1') else op('/')
            )
        except Exception as e:
            print(f"Error starting animation: {e}")

    def stopAnimation(self) -> None:
        """Stop animation loop"""
        try:
            if self.animationTimer:
                self.animationTimer.destroy()
                self.animationTimer = None
        except Exception as e:
            print(f"Error stopping animation: {e}")

    def animate(self) -> None:
        """Animation frame callback"""
        try:
            self.parser.draw()
            self.updateOutput()
            self.updateErrorOutput()

            # Continue animation if playing
            if hasattr(self.ownerComp.par, 'play') and self.ownerComp.par.play.eval():
                from types import run, op
                self.animationTimer = run(
                    "args[0].animate()",
                    self,
                    delayFrames=1,
                    delayRef=op('timer1') if op('timer1') else op('/')
                )
        except Exception as e:
            print(f"Error in animation frame: {e}")

    def resetParser(self) -> None:
        """Reset parser state"""
        try:
            if self.sourceDAT and hasattr(self.sourceDAT, 'text'):
                self.parser.setup(self.sourceDAT.text)
                self.updateOutput()
                self.updateErrorOutput()
        except Exception as e:
            print(f"Error resetting parser: {e}")

    def startRecording(self) -> None:
        """Start video recording"""
        if self.isRecording:
            return
        try:
            self.isRecording = True
            if self.movieOut and hasattr(self.movieOut.par, 'record'):
                self.movieOut.par.record = True
            print("Recording started")
        except Exception as e:
            print(f"Error starting recording: {e}")

    def stopRecording(self) -> None:
        """Stop video recording"""
        if not self.isRecording:
            return
        try:
            self.isRecording = False
            if self.movieOut and hasattr(self.movieOut.par, 'record'):
                self.movieOut.par.record = False
            print("Recording stopped")
        except Exception as e:
            print(f"Error stopping recording: {e}")

    def updateOutput(self) -> None:
        """Update visual and audio output"""
        self.updateGeometry()
        self.updateAudio()
        self.updateData()

    def updateGeometry(self) -> None:
        """Convert parser data to TouchDesigner geometry"""
        if not self.geometryComp:
            return

        try:
            geo = self.geometryComp.op('geo1')
            if not geo:
                return

            # Clear existing geometry
            self.output.geometry.clear()
            geo.clear()

            # Convert parser groups to geometry
            for group in self.parser.groups:
                points = group.flat()
                if len(points) > 0:
                    # Add all points to both our output and TD geometry
                    point_indices = []
                    for point in points:
                        if len(point) >= 2:
                            # Add to our geometry output
                            idx = self.output.geometry.add_point(
                                point[0], point[1], 0.0)
                            point_indices.append(idx)

                            # Add to TouchDesigner geometry
                            geo.appendPoint()
                            geo.points[-1].P = [point[0], point[1], 0.0]

                    # Create curve primitive if we have multiple points
                    if len(point_indices) > 1:
                        self.output.geometry.add_primitive(point_indices)

                        # Create TD primitive
                        prim = geo.appendPrim()
                        for i, idx in enumerate(point_indices):
                            prim.addVertex(geo.points[i])

        except Exception as e:
            print(f"Error updating geometry: {e}")

    def updateAudio(self) -> None:
        """Update audio output"""
        if not self.audioOut:
            return

        try:
            # Clear audio output
            self.output.audio.clear()

            # Convert parser OSC output to CHOP data
            for osc_msg in self.parser.output.osc:
                if isinstance(osc_msg, dict) and 'address' in osc_msg:
                    address = osc_msg['address']
                    args = osc_msg.get('args', [])

                    # Convert to channel data
                    if args:
                        channel_name = address.replace('/', '_').lstrip('_')
                        self.output.audio.add_channel(
                            channel_name, [float(args[0])])

        except Exception as e:
            print(f"Error updating audio: {e}")

    def updateData(self) -> None:
        """Update data output"""
        try:
            # Update params DAT if it exists
            if self.paramsDAT:
                params_data = [
                    ['Parameter', 'Value'],
                    ['progress', str(self.parser.progress.progress)],
                    ['duration', str(self.parser.totalLength)],
                    ['groups', str(len(self.parser.groups))],
                    ['errors', str(len(self.parser.output.errors))]
                ]

                # Store in our output
                self.output.data.set_table(params_data)

        except Exception as e:
            print(f"Error updating data: {e}")

    def updateErrorOutput(self) -> None:
        """Update error output"""
        try:
            if self.errorDAT and hasattr(self.errorDAT, 'text'):
                errors = self.parser.output.errors
                if errors:
                    error_text = '\n'.join(errors)
                    self.errorDAT.text = error_text
                    self.output.errors = errors.copy()
                else:
                    self.errorDAT.text = ""
                    self.output.errors.clear()

        except Exception as e:
            print(f"Error updating error output: {e}")

    def onPulse(self, par: TDParameter) -> None:
        """Handle pulse parameters"""
        try:
            if par.name == 'reset':
                self.resetParser()
            elif par.name == 'export':
                self.exportTox()
        except Exception as e:
            print(f"Error handling pulse: {e}")

    def exportTox(self) -> None:
        """Export as .tox file"""
        try:
            from types import tdu
            filename = f"Asemic_{tdu.digits(4)}.tox"
            self.ownerComp.save(filename)
            print(f"Exported to {filename}")
        except Exception as e:
            print(f"Error exporting: {e}")

    def getOutput(self) -> TouchDesignerOutput:
        """Get current output data"""
        return self.output

    def getParams(self) -> TouchDesignerParams:
        """Get current parameters"""
        return self.params


# Global reference for TouchDesigner
try:
    # This will be defined by TouchDesigner
    ext = AsemicExtension(me)  # type: ignore
except NameError:
    # For testing outside TouchDesigner
    print("Running outside TouchDesigner environment")
    ext = None
