import { VideoTexture } from 'three';
export class AsemicInput {
    constructor(type, props) {
        this.dynamic = true;
        this.width = 1080;
        this.height = 1920;
        this.width = props.dimensions[0];
        this.height = props.dimensions[1];
        this.type = type;
        this.props = props;
    }
    async initCam(constraints) {
        return await navigator.mediaDevices
            .getUserMedia(constraints)
            .then(stream => {
            this.video.srcObject = stream;
            this.video.play();
        });
    }
    async initVideo(url) {
        this.video.src = url;
        this.video.play();
        return new Promise(res => {
            this.video.addEventListener('loadeddata', () => {
                res(undefined);
            });
        });
    }
    // TODO: figure out how to initialize a stream
    async initStream(streamName) {
        let self = this;
        // if (streamName && this.pb) {
        // this.pb.initSource(streamName)
        // this.pb.on('got video', function (nick, video) {
        //   if (nick === streamName) {
        //     self.src = video
        //     self.dynamic = true
        //     self.tex = self.regl.texture({ data: self.src, ...params})
        //   }
        // })
        // }
    }
    // index only relevant in atom-hydra + desktop apps
    async initScreen(options) {
        const constraints = {};
        return await navigator.mediaDevices
            .getDisplayMedia(constraints)
            .then(stream => {
            this.video.srcObject = stream;
            this.video.play();
        });
    }
    resize(width, height) {
        this.width = width;
        this.height = height;
        this.video.width = width;
        this.video.height = height;
        // needed?
        // this.tex.dispose()
        // this.tex = new VideoTexture(this.src)
    }
    async init() {
        var _a, _b;
        // if (this.src && this.src.srcObject) {
        //   if (this.src.srcObject.getTracks) {
        //     this.src.srcObject.getTracks().forEach(track => track.stop())
        //   }
        // }
        (_a = this.video) === null || _a === void 0 ? void 0 : _a.remove();
        this.video = document.createElement('video');
        this.video.style.display = 'none';
        document.body.appendChild(this.video);
        this.video.width = this.width;
        this.video.height = this.height;
        this.video.muted = true;
        this.video.autoplay = true;
        this.video.loop = true;
        (_b = this.texture) === null || _b === void 0 ? void 0 : _b.dispose();
        this.texture = new VideoTexture(this.video);
        switch (this.type) {
            case 'cam':
                await this.initCam(this.props.src);
                break;
            case 'screen':
                await this.initScreen(this.props.src);
                break;
            case 'stream':
                await this.initStream(this.props.src);
                break;
            case 'video':
                await this.initVideo(this.props.src);
                break;
        }
        return this.texture;
    }
}
export default AsemicInput;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiSW5wdXQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJJbnB1dC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxPQUFPLEVBQUUsWUFBWSxFQUFFLE1BQU0sT0FBTyxDQUFBO0FBZXBDLE1BQU0sT0FBTyxXQUFXO0lBU3RCLFlBQVksSUFBTyxFQUFFLEtBQXVCO1FBUjVDLFlBQU8sR0FBRyxJQUFJLENBQUE7UUFDZCxVQUFLLEdBQUcsSUFBSSxDQUFBO1FBQ1osV0FBTSxHQUFHLElBQUksQ0FBQTtRQU9YLElBQUksQ0FBQyxLQUFLLEdBQUcsS0FBSyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQTtRQUNoQyxJQUFJLENBQUMsTUFBTSxHQUFHLEtBQUssQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUE7UUFDakMsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUE7UUFDaEIsSUFBSSxDQUFDLEtBQUssR0FBRyxLQUFLLENBQUE7SUFDcEIsQ0FBQztJQUVELEtBQUssQ0FBQyxPQUFPLENBQUMsV0FBb0M7UUFDaEQsT0FBTyxNQUFNLFNBQVMsQ0FBQyxZQUFZO2FBQ2hDLFlBQVksQ0FBQyxXQUFXLENBQUM7YUFDekIsSUFBSSxDQUFDLE1BQU0sQ0FBQyxFQUFFO1lBQ2IsSUFBSSxDQUFDLEtBQUssQ0FBQyxTQUFTLEdBQUcsTUFBTSxDQUFBO1lBQzdCLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLENBQUE7UUFDbkIsQ0FBQyxDQUFDLENBQUE7SUFDTixDQUFDO0lBRUQsS0FBSyxDQUFDLFNBQVMsQ0FBQyxHQUFXO1FBQ3pCLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxHQUFHLEdBQUcsQ0FBQTtRQUNwQixJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxDQUFBO1FBQ2pCLE9BQU8sSUFBSSxPQUFPLENBQUMsR0FBRyxDQUFDLEVBQUU7WUFDdkIsSUFBSSxDQUFDLEtBQUssQ0FBQyxnQkFBZ0IsQ0FBQyxZQUFZLEVB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bEUsTUFBSztZQUNQLEtBQUssT0FBTztnQkFDVixNQUFNLElBQUksQ0FBQyxTQUFTLENBQUUsSUFBSSxDQUFDLEtBQWdDLENBQUMsR0FBRyxDQUFDLENBQUE7Z0JBQ2hFLE1BQUs7UUFDVCxDQUFDO1FBQ0QsT0FBTyxJQUFJLENBQUMsT0FBTyxDQUFBO0lBQ3JCLENBQUM7Q0FDRjtBQUVELGVBQWUsV0FBVyxDQUFBIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgVmlkZW9UZXh0dXJlIH0gZnJvbSAndGhyZWUnXG5cbnR5cGUgU3JjS2V5ID0gJ3ZpZGVvJyB8ICdzdHJlYW0nIHwgJ2NhbScgfCAnc2NyZWVuJ1xudHlwZSBTcmNQcm9wZXJ0aWVzPFQgZXh0ZW5kcyBTcmNLZXk+ID0ge1xuICBkaW1lbnNpb25zOiBbbnVtYmVyLCBudW1iZXJdXG59ICYgKFQgZXh0ZW5kcyAndmlkZW8nXG4gID8geyBzcmM6IHN0cmluZyB9XG4gIDogVCBleHRlbmRzICdzdHJlYW0nXG4gID8geyBzcmM/OiBNZWRpYVN0cmVhbSB9XG4gIDogVCBleHRlbmRzICdjYW0nXG4gID8geyBzcmM/OiBNZWRpYVN0cmVhbUNvbnN0cmFpbnRzIH1cbiAgOiBUIGV4dGVuZHMgJ3NjcmVlbidcbiAgPyB7IHNyYz86IERpc3BsYXlNZWRpYVN0cmVhbU9wdGlvbnMgfVxuICA6IG5ldmVyKVxuXG5leHBvcnQgY2xhc3MgQXNlbWljSW5wdXQ8VCBleHRlbmRzIFNyY0tleT4ge1xuICBkeW5hbWljID0gdHJ1ZVxuICB3aWR0aCA9IDEwODBcbiAgaGVpZ2h0ID0gMTkyMFxuICB2aWRlbyE6IEhUTUxWaWRlb0VsZW1lbnRcbiAgdGV4dHVyZSE6IFZpZGVvVGV4dHVyZVxuICB0eXBlOiBUXG4gIHByb3BzOiBTcmNQcm9wZXJ0aWVzPFQ+XG5cbiAgY29uc3RydWN0b3IodHlwZTogVCwgcHJvcHM6IFNyY1Byb3BlcnRpZXM8VD4pIHtcbiAgICB0aGlzLndpZHRoID0gcHJvcHMuZGltZW5zaW9uc1swXVxuICAgIHRoaXMuaGVpZ2h0ID0gcHJvcHMuZGltZW5zaW9uc1sxXVxuICAgIHRoaXMudHlwZSA9IHR5cGVcbiAgICB0aGlzLnByb3BzID0gcHJvcHNcbiAgfVxuXG4gIGFzeW5jIGluaXRDYW0oY29uc3RyYWludHM/OiBNZWRpYVN0cmVhbUNvbnN0cmFpbnRzKSB7XG4gICAgcmV0dXJuIGF3YWl0IG5hdmlnYXRvci5tZWRpYURldmljZXNcbiAgICAgIC5nZXRVc2VyTWVkaWEoY29uc3RyYWludHMpXG4gICAgICAudGhlbihzdHJlYW0gPT4ge1xuICAgICAgICB0aGlzLnZpZGVvLnNyY09iamVjdCA9IHN0cmVhbVxuICAgICAgICB0aGlzLnZpZGVvLnBsYXkoKVxuICAgICAgfSlcbiAgfVxuXG4gIGFzeW5jIGluaXRWaWRlbyh1cmw6IHN0cmluZykge1xuICAgIHRoaXMudmlkZW8uc3JjID0gdXJsXG4gICAgdGhpcy52aWRlby5wbGF5KClcbiAgICByZXR1cm4gbmV3IFByb21pc2UocmVzID0+IHtcbiAgICAgIHRoaXMudmlkZW8uYWRkRXZlbnRMaXN0ZW5lcignbG9hZGVkZGF0YScsICgpID0+IHtcbiAgICAgICAgcmVzKHVuZGVmaW5lZClcbiAgICAgIH0pXG4gICAgfSlcbiAgfVxuXG4gIC8vIFRPRE86IGZpZ3VyZSBvdXQgaG93IHRvIGluaXRpYWxpemUgYSBzdHJlYW1cbiAgYXN5bmMgaW5pdFN0cmVhbShzdHJlYW1OYW1lKSB7XG4gICAgbGV0IHNlbGYgPSB0aGlzXG4gICAgLy8gaWYgKHN0cmVhbU5hbWUgJiYgdGhpcy5wYikge1xuICAgIC8vIHRoaXMucGIuaW5pdFNvdXJjZShzdHJlYW1OYW1lKVxuXG4gICAgLy8gdGhpcy5wYi5vbignZ290IHZpZGVvJywgZnVuY3Rpb24gKG5pY2ssIHZpZGVvKSB7XG4gICAgLy8gICBpZiAobmljayA9PT0gc3RyZWFtTmFtZSkge1xuICAgIC8vICAgICBzZWxmLnNyYyA9IHZpZGVvXG4gICAgLy8gICAgIHNlbGYuZHluYW1pYyA9IHRydWVcbiAgICAvLyAgICAgc2VsZi50ZXggPSBzZWxmLnJlZ2wudGV4dHVyZSh7IGRhdGE6IHNlbGYuc3JjLCAuLi5wYXJhbXN9KVxuICAgIC8vICAgfVxuICAgIC8vIH0pXG4gICAgLy8gfVxuICB9XG5cbiAgLy8gaW5kZXggb25seSByZWxldmFudCBpbiBhdG9tLWh5ZHJhICsgZGVza3RvcCBhcHBzXG4gIGFzeW5jIGluaXRTY3JlZW4ob3B0aW9ucz86IERpc3BsYXlNZWRpYVN0cmVhbU9wdGlvbnMpIHtcbiAgICBjb25zdCBjb25zdHJhaW50cyA9IHt9XG4gICAgcmV0dXJuIGF3YWl0IG5hdmlnYXRvci5tZWRpYURldmljZXNcbiAgICAgIC5nZXREaXNwbGF5TWVkaWEoY29uc3RyYWludHMpXG4gICAgICAudGhlbihzdHJlYW0gPT4ge1xuICAgICAgICB0aGlzLnZpZGVvLnNyY09iamVjdCA9IHN0cmVhbVxuICAgICAgICB0aGlzLnZpZGVvLnBsYXkoKVxuICAgICAgfSlcbiAgfVxuXG4gIHJlc2l6ZSh3aWR0aCwgaGVpZ2h0KSB7XG4gICAgdGhpcy53aWR0aCA9IHdpZHRoXG4gICAgdGhpcy5oZWlnaHQgPSBoZWlnaHRcbiAgICB0aGlzLnZpZGVvLndpZHRoID0gd2lkdGhcbiAgICB0aGlzLnZpZGVvLmhlaWdodCA9IGhlaWdodFxuICAgIC8vIG5lZWRlZD9cbiAgICAvLyB0aGlzLnRleC5kaXNwb3NlKClcbiAgICAvLyB0aGlzLnRleCA9IG5ldyBWaWRlb1RleHR1cmUodGhpcy5zcmMpXG4gIH1cblxuICBhc3luYyBpbml0KCkge1xuICAgIC8vIGlmICh0aGlzLnNyYyAmJiB0aGlzLnNyYy5zcmNPYmplY3QpIHtcbiAgICAvLyAgIGlmICh0aGlzLnNyYy5zcmNPYmplY3QuZ2V0VHJhY2tzKSB7XG4gICAgLy8gICAgIHRoaXMuc3JjLnNyY09iamVjdC5nZXRUcmFja3MoKS5mb3JFYWNoKHRyYWNrID0+IHRyYWNrLnN0b3AoKSlcbiAgICAvLyAgIH1cbiAgICAvLyB9XG4gICAgdGhpcy52aWRlbz8ucmVtb3ZlKClcbiAgICB0aGlzLnZpZGVvID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndmlkZW8nKVxuICAgIHRoaXMudmlkZW8uc3R5bGUuZGlzcGxheSA9ICdub25lJ1xuICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQodGhpcy52aWRlbylcbiAgICB0aGlzLnZpZGVvLndpZHRoID0gdGhpcy53aWR0aFxuICAgIHRoaXMudmlkZW8uaGVpZ2h0ID0gdGhpcy5oZWlnaHRcbiAgICB0aGlzLnZpZGVvLm11dGVkID0gdHJ1ZVxuICAgIHRoaXMudmlkZW8uYXV0b3BsYXkgPSB0cnVlXG4gICAgdGhpcy52aWRlby5sb29wID0gdHJ1ZVxuICAgIHRoaXMudGV4dHVyZT8uZGlzcG9zZSgpXG4gICAgdGhpcy50ZXh0dXJlID0gbmV3IFZpZGVvVGV4dHVyZSh0aGlzLnZpZGVvKVxuXG4gICAgc3dpdGNoICh0aGlzLnR5cGUpIHtcbiAgICAgIGNhc2UgJ2NhbSc6XG4gICAgICAgIGF3YWl0IHRoaXMuaW5pdENhbSgodGhpcy5wcm9wcyBhcyBTcmNQcm9wZXJ0aWVzPCdjYW0nPikuc3JjKVxuICAgICAgICBicmVha1xuICAgICAgY2FzZSAnc2NyZWVuJzpcbiAgICAgICAgYXdhaXQgdGhpcy5pbml0U2NyZWVuKCh0aGlzLnByb3BzIGFzIFNyY1Byb3BlcnRpZXM8J3NjcmVlbic+KS5zcmMpXG4gICAgICAgIGJyZWFrXG4gICAgICBjYXNlICdzdHJlYW0nOlxuICAgICAgICBhd2FpdCB0aGlzLmluaXRTdHJlYW0oKHRoaXMucHJvcHMgYXMgU3JjUHJvcGVydGllczwnc3RyZWFtJz4pLnNyYylcbiAgICAgICAgYnJlYWtcbiAgICAgIGNhc2UgJ3ZpZGVvJzpcbiAgICAgICAgYXdhaXQgdGhpcy5pbml0VmlkZW8oKHRoaXMucHJvcHMgYXMgU3JjUHJvcGVydGllczwndmlkZW8nPikuc3JjKVxuICAgICAgICBicmVha1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy50ZXh0dXJlXG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgQXNlbWljSW5wdXRcbiJdfQ==